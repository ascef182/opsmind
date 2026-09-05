# OpsMind — PRD v2: Arquitetura de Produção, Segurança e Confiança

Versão 2.0 — 02/09/2026

**Escopo:** este documento **complementa** o `PRD.md` (v1.1) — não o substitui e não duplica seu conteúdo.
`PRD.md` continua sendo a fonte de Visão, Problema, Personas, Casos de Uso, Módulos, MVP e Roadmap por Fases.
Este documento cobre os domínios que sustentam uma operação real em produção — segurança, confiabilidade,
observabilidade, compliance e monetização — como requisitos próprios com critério de aceitação verificável, em
vez de menções pontuais dentro de outras seções.

Em caso de conflito de conteúdo entre os dois documentos: `PRD.md` prevalece em tópicos de produto (Visão,
Personas, MVP); este documento prevalece em tópicos de arquitetura, segurança e operação.

**Princípio geral:** "production-ready" não significa livre de vulnerabilidades ou infinitamente escalável;
significa que o sistema tem controles de segurança explícitos, objetivos de confiabilidade mensuráveis,
recuperação de falha testada, acesso controlado, comportamento observável e procedimentos operacionais
documentados. Nenhuma arquitetura garante uma empresa de sucesso — uma boa arquitetura garante que o sucesso
não seja limitado por fragilidade técnica.

---

## 1. Princípio: Zero Trust

Nenhuma camada do sistema confia implicitamente na anterior — cada camada reautentica e reautoriza, mesmo
quando a chamada já veio de dentro do próprio sistema.

- O guard HTTP (`TenantGuard`/`RolesGuard`) não é suficiente por si só: a Row-Level Security do Postgres
  (role `opsmind_app`, sem `BYPASSRLS`) é a segunda barreira, que continua valendo mesmo se um guard tiver um
  bug — essa é a razão de a arquitetura já usar defesa em duas camadas para multi-tenancy (ver `PRD.md §10.1`
  e `§14`).
- Toda requisição — humana ou de uma tool de IA — é reautorizada no nível do recurso específico que está
  acessando, nunca herdando confiança de uma chamada anterior na mesma sessão ou conversa.
- Credenciais de terceiros (integrações) nunca ficam decifradas em memória além da janela exata de uso — ver
  princípio de "decrypt na fronteira de execução" em §2.5.
- Comunicação interna (worker ↔ API ↔ fila) não assume que uma mensagem é confiável só por estar na fila: todo
  job revalida o `organization_id` do payload contra o registro que está manipulando antes de agir.

**Critérios de aceitação:**
- Existe um teste que desativa o `TenantGuard` de aplicação e comprova que a RLS sozinha ainda impede leitura
  cross-tenant.
- Existe um teste que injeta, no payload de um job de fila, um `organization_id` divergente do registro real e
  comprova que o worker rejeita o processamento em vez de executar.

---

## 2. Segurança e Identidade

### 2.1 Identidade, Autenticação e Sessão

**v1 (obrigatório para produção):**
- Verificação de e-mail obrigatória e fluxo de reset de senha (já descrito em `PRD.md §14`).
- Rotação de refresh token a cada uso, com detecção de reuso (*refresh token reuse detection*): reutilizar um
  token já trocado por um novo é tratado como sinal de comprometimento.
- Revogação de sessão (logout remoto / "sair de todos os dispositivos"), invalidando tokens já emitidos, não
  só impedindo emissão de novos.
- Detecção de anomalia de login (novo device/IP/geolocalização) e rate limiting progressivo contra força bruta
  em `/auth/login`.

**v2 (roadmap — ver §12):** MFA via TOTP com códigos de recuperação, SSO/SAML, provisionamento via SCIM.

**Critérios de aceitação:**
- Reutilizar um refresh token já trocado por um novo dispara a revogação de toda a família de tokens daquela
  sessão (teste automatizado).
- Um usuário consegue encerrar todas as sessões ativas de sua conta a partir de um único endpoint, e uma
  chamada subsequente com o token antigo retorna 401.
- N tentativas de login falhas em M minutos disparam um bloqueio temporário mensurável (limite configurável,
  não "alguma proteção existe").

### 2.2 Autorização e Segurança de API

A arquitetura atual já implementa três níveis de autorização; esta seção os formaliza como requisito explícito
e adiciona o que falta:

- **Object-level**: `TenantGuard` valida `:organizationId` contra `Membership` antes do
  `TenantContextInterceptor` abrir a transação — a RLS tem branches `IS NULL` para tolerar essa ordem de
  execução (ver comentário no topo de `enable_row_level_security/migration.sql`).
- **Function-level**: `RolesGuard` + `@Roles(...WRITE_ROLES)` controlam quais papéis podem executar qual ação.
- **Property-level**: `canAssignRole()` impede um usuário de conceder/revogar um papel igual ou acima do seu
  próprio.

Itens exigidos como novos requisitos:
- Rate limiting por organização/usuário, não só global.
- Limite de tamanho de payload por rota.
- Idempotência em mutações críticas (chave de idempotência em criação de recursos financeiros/outreach).
- Proteção contra replay em webhooks recebidos (nonce/timestamp).
- Proteção SSRF em qualquer chamada de rede iniciada a partir de input do usuário (relevante para o pipeline
  de enrichment que busca conteúdo de uma URL fornecida por um lead/scraper — ver §8).
- Versionamento de API (`/v1/...`) para não quebrar integrações enterprise futuras (ver §12).

**Critérios de aceitação:**
- Um teste e2e comprova que um usuário `MEMBER` recebe 403 ao tentar promover outro usuário a `OWNER`.
- Um teste comprova que uma URL apontando para um range de IP interno (`127.0.0.1`, `169.254.169.254`,
  faixas RFC1918) é rejeitada por qualquer feature que busca conteúdo de URL fornecida externamente.
- Reenviar o mesmo webhook (mesmo `event_id`) duas vezes produz efeito único no sistema.

### 2.3 Segurança da Camada de IA e Classificação de Risco de Tools

Cada tool de IA (`apps/api/src/modules/ai/tools/*.tool.ts`) passa a declarar metadados de risco, além do
`inputSchema` já existente:

```
tool
required_role
resource
action
risk_level          (READ | WRITE | DELETE)
requires_confirmation
```

Regra de execução: `READ` executa automaticamente; `WRITE` exige a mesma autorização já garantida hoje pelo
guard compartilhado com as rotas HTTP; `DELETE` exige confirmação explícita do usuário na conversa antes de
`AiService.chat()` (loop de até `MAX_ITERATIONS = 8`) executar o tool call.

Princípios já implementados e formalizados aqui como requisito testável, não só decisão de design:
- Nenhum `inputSchema` de tool expõe `organizationId`/`userId`/`role` como campo controlável pelo modelo —
  esse contexto (`AiToolContext`) é sempre injetado a partir da requisição autenticada.
- Toda ação de IA (leitura sensível, escrita, exclusão) grava um `AuditLog` com o mesmo nível de detalhe de
  uma ação humana.
- Conteúdo de documento/mensagem externa é sempre tratado como dado delimitado, nunca como instrução —
  proteção de prompt injection, já coberta pela categoria correspondente do eval suite
  (`apps/api/eval/dataset.ts`).

Requisito novo: o eval suite de prompt-injection deve rodar no CI contra o modelo usado em **produção**
(`claude-opus-5`), não contra `claude-sonnet-5` como hoje configurado no script `eval` — a suite de segurança
não pode validar um modelo diferente do que os usuários realmente usam.

**Critérios de aceitação:**
- Toda tool no diretório `ai/tools/` tem `risk_level` definido, verificado por um teste unitário que falha o
  build se uma tool nova não declarar o campo.
- Um teste de integração comprova que uma tool classificada como `DELETE` não executa sem um passo de
  confirmação explícito na conversa.
- O eval suite de prompt-injection roda no CI contra o modelo de produção e falha o job se qualquer caso
  "vazar" a instrução maliciosa.

### 2.4 Policy Engine

Módulo centralizado — hoje inexistente, a checagem de permissão de tool está espalhada por guard/tool — que
resolve uma decisão a partir de:

```
WHO (ator) × WHAT (ação) × RESOURCE (tipo/instância) × TENANT (organização)
× ROLE × CONTEXT (ex.: horário, IP, flag ativa) × RISK (herdado de §2.3)
    → ALLOW | DENY | REQUIRE_CONFIRMATION
```

- Usado tanto pelas rotas HTTP quanto pelas tools de IA através do mesmo ponto de decisão — unifica dois
  mecanismos hoje paralelos (`RolesGuard` e a checagem de tool), sem remover o guard HTTP em si (a defesa em
  profundidade de §1 continua).
- Toda decisão do Policy Engine é logável com o motivo da decisão, não só o resultado — necessário para
  auditoria de segurança.
- Evolução planejada, não retrofit completo: pode nascer como uma função pura (`evaluatePolicy(input):
  Decision`) chamada pelos guards existentes, antes de virar um serviço com regras configuráveis por
  organização (roadmap, ver §12).

**Critérios de aceitação:**
- Existe uma suíte de testes tabular (matriz papel × ação × recurso) cobrindo os 5 papéis × os 3 níveis de
  risco de tool (`READ`/`WRITE`/`DELETE`).
- Uma mudança de regra no Policy Engine é testável isoladamente por unit test, sem exigir um teste e2e
  completo por regra.

### 2.5 Segredos e Gestão de Chaves

- Segredos de produção migram de variáveis de ambiente (hoje validadas por Zod em
  `packages/config/env/schema.ts`) para um Secret Manager gerenciado, com rotação programada.
- Nenhum segredo é logado em texto plano — auditado por um scanner (ver §5), nunca só por revisão manual.
- TLS obrigatório em trânsito; campos de alto valor (ex.: token de integração de terceiro — WhatsApp, Google,
  Explorium) cifrados em repouso a nível de aplicação, não só disco.
- **Decrypt somente na fronteira de execução**: um token de integração de terceiro é decifrado apenas no
  momento exato da chamada de rede que o usa, nunca mantido decifrado em memória além disso, e nunca passado
  decifrado por camadas intermediárias (fila, log, cache).
- Credenciais de curto prazo/workload identity para os serviços que suportam (banco, storage), reduzindo o uso
  de chaves estáticas de longa duração.
- Rotação de chave de criptografia (KMS) inclui plano de re-criptografia de dado já existente, não só troca de
  chave para dado novo.

**Critérios de aceitação:**
- Um scanner de secret roda no CI e falha o build se encontrar um padrão de chave/token em código ou em log de
  teste.
- Um teste comprova que um token de integração de terceiro nunca aparece decifrado em um payload de job
  BullMQ — só o ciphertext trafega pela fila.
- Existe um runbook de rotação de chave KMS testado em modo dry-run, sem downtime.

### 2.6 Suíte Adversarial de Isolamento de Tenant

Suíte de testes negativos dedicada — distinta dos testes funcionais que já existem — tentando ativamente vazar
dado cross-tenant em cada uma das superfícies do sistema:

| Superfície | Vetor de ataque testado |
|---|---|
| REST | `GET /customers/:id` de uma organização diferente da do usuário autenticado |
| Tools de IA | Tool chamada por usuário da org A referenciando recurso da org B |
| Workers/filas | Job com `organization_id` divergente do recurso que ele manipula (ver §1) |
| Documentos/storage | URL assinada de um documento sendo usada a partir de outra organização |
| Exports | Export de CSV/relatório vazando linha pertencente a outra organização |
| Webhooks | Payload de webhook interpretado no contexto de organização errada |
| Analytics/dashboard | Agregação vazando contagem/soma de dado de outra organização |

Roda contra a stack real com RLS ativa (role `opsmind_app`, não a role de migration com privilégio de
superusuário) — o mesmo setup que `infra/docker/init/02-app-role.sql` já provê para o CI, formalizado aqui
como gate obrigatório, não apenas configuração incidental.

**Critérios de aceitação:**
- A suíte roda no CI como job dedicado (ou dentro de `test:e2e`) e falha o pipeline se qualquer caso vazar
  dado cross-tenant.
- Cobertura mínima de 1 caso por superfície listada acima (≥ 7 casos), rastreável em um relatório que associa
  nome do teste ↔ superfície coberta.

---

## 3. Modelagem de Ameaças (Threat Model)

Formato: `Ativo → Ameaça → Superfície de Ataque → Probabilidade → Impacto → Controle → Teste`.

**Exemplo 1 — Acesso a dado cross-tenant**
- Ativo: dados de clientes/documentos de uma organização.
- Ameaça: usuário de uma organização lendo ou escrevendo dado de outra.
- Superfície: qualquer endpoint com `:organizationId`, tool de IA, ou worker.
- Probabilidade: média (erro de guard é o vetor mais comum de vazamento cross-tenant).
- Impacto: alto (vazamento de dado de cliente, quebra de confiança comercial).
- Controle: RLS (`opsmind_app` sem `BYPASSRLS`) + `TenantGuard` + filtro explícito de `organization_id` nas
  queries (defesa em profundidade — ver §1).
- Teste: Suíte Adversarial de Isolamento de Tenant (§2.6).

**Exemplo 2 — Prompt injection via documento**
- Ativo: integridade da resposta e das ações executadas pela IA.
- Ameaça: documento com instrução maliciosa embutida altera o comportamento do agente além do escopo da
  pergunta feita.
- Superfície: pipeline de RAG (`search_documents`) e qualquer conteúdo externo injetado no prompt.
- Probabilidade: média-alta (vetor conhecido e fácil de tentar).
- Impacto: alto (ação não autorizada via tool call).
- Controle: separação dado/instrução no prompt + classificação de risco de tool (§2.3).
- Teste: categoria `prompt-injection` do eval suite, rodando contra o modelo de produção.

**Ameaças adicionais a manter na tabela (sem detalhamento completo aqui):** exfiltração de dado via
export/relatório; abuso do orçamento de IA (custo descontrolado); SSRF via enrichment de lead (§8);
replay de webhook; escalonamento de papel via API.

**Critérios de aceitação:**
- Toda linha da tabela tem um teste ou métrica associado, rastreável por nome — não "monitoramos isso
  informalmente".
- A tabela é revisada a cada nova feature de risco (IA, integração externa) antes do merge, referenciada pelo
  checklist de PR.

---

## 4. Confiabilidade e Operação em Produção

### 4.1 SLOs, SLIs e Orçamento de Erro

SLIs mínimos: disponibilidade da API, latência p95 de `/ai/chat` (excluindo geração de tokens em stream),
latência p95 de endpoints CRUD, taxa de sucesso de jobs por fila (`document-processing`,
`automation-execution`, `ai-tool-execution`, `notifications`).

Alvos de exemplo (a calibrar com dado real de uso): 99.5% de disponibilidade mensal; p95 < 3s em `/ai/chat`;
p95 < 300ms em CRUD simples; < 1% de jobs indo para dead-letter por fila. O orçamento de erro consumido fica
visível em dashboard (§6), não só aparece durante um incidente.

### 4.2 Planejamento de Capacidade

O `TenantContextInterceptor` abre uma transação Postgres por requisição — essa decisão arquitetural consome
conexão de forma mais agressiva que uma query direta, e deve ser monitorada quanto à saturação do pool sob
carga. Um teste de carga mínimo é exigido antes de qualquer expansão de tier de plano (§10) que aumente a
concorrência esperada.

### 4.3 Degradação Graciosa e Falha de Dependências

- **Provider de IA indisponível**: `/ai/chat` retorna um erro claro sem derrubar o resto da API (hoje já é
  fail-late; formaliza-se como circuit breaker/fallback, não um erro 500 genérico).
- **Redis/fila indisponível**: escrita síncrona (CRM/tasks) continua funcionando normalmente; apenas
  automações e processamento assíncrono degradam, com a fila acumulando para reprocessar quando o serviço
  voltar — nenhum job é perdido.
- **Embedding provider (OpenAI) indisponível**: upload de documento aceita o arquivo mas marca
  `status: processing` com retry, em vez de falhar o upload inteiro.

### 4.4 Disaster Recovery

- Backup automatizado do Postgres com point-in-time recovery (PITR) habilitado.
- Backups criptografados, com retenção definida (cross-ref §9.4).
- RPO/RTO alvo explícitos — números, não aspiração (ex.: RPO ≤ 15min, RTO ≤ 4h).
- Loop de teste de restore: restaurar periodicamente em ambiente isolado e validar integridade dos dados, não
  apenas confirmar que o backup existe.

**Critérios de aceitação (seção 4 como um todo):**
- Existe um dashboard mostrando SLI atual vs. SLO por serviço/fila.
- Um teste de restore de backup roda com cadência definida (ex.: mensal) e produz um relatório pass/fail com
  timestamp.
- Um teste simulando indisponibilidade do provider de IA (erro 503) comprova que o resto da API continua
  respondendo normalmente.

---

## 5. Cadeia de Suprimentos e CI/CD Seguro

O pipeline atual (`.github/workflows/ci.yml`) segue: checkout → install → `prisma generate` → habilitar
pgvector → `migrate deploy` → criar role restrita `opsmind_app` → lint → typecheck → test → test:e2e (+ job
separado `eval-suite`). Esta seção adiciona gates de segurança, posicionados para falhar rápido e barato:

- **Logo após install** (antes do build custoso): secret scanning e dependency/SAST scanning.
- **No build da imagem de produção**, antes do deploy: container/image scanning e geração de SBOM.

Itens exigidos:
- Dependency scanning com atualização automatizada (Dependabot/Renovate), com gate de severidade: uma
  vulnerabilidade `critical`/`high` sem patch disponível vira uma exceção documentada, nunca um silêncio.
- SAST (ex.: Semgrep/CodeQL) sobre `apps/api`/`apps/worker`, com atenção a regras customizadas para os padrões
  de segurança já estabelecidos (ex.: alertar sobre uso de `$queryRawUnsafe` sem parametrização, ou sobre um
  endpoint novo que não passa por `TenantGuard`).
- Imagens de container com base mínima e non-root, digest pinado (nunca `latest`), assinatura de imagem antes
  do deploy, e SBOM gerado por build e anexado ao artefato de release.

**Critérios de aceitação:**
- O CI tem um job `security-scan`, rodando antes de `test:e2e`/`eval-suite`, que bloqueia merge em achado
  `critical` sem exceção registrada.
- Toda imagem de produção publicada tem um SBOM associado e é assinada; um deploy sem assinatura válida é
  rejeitado automaticamente.
- Uma dependência desatualizada com CVE conhecida gera um PR automático rastreável.

---

## 6. Observabilidade e FinOps

### 6.1 Plataforma de Observabilidade

Hoje: Sentry (`SentryGlobalFilter` como primeiro `APP_FILTER`) + `nestjs-pino` (JSON em produção). Falta
correlação entre camadas — não existe hoje um identificador único que atravesse HTTP → chamada de IA → tool
call → query no banco → job de fila → worker.

- Um `trace_id` é gerado no `TenantContextInterceptor` (o mesmo ponto onde a transação e os `SET LOCAL`
  já acontecem hoje), propagado para `AIRequest`, para o payload do job BullMQ, e logado pelo worker —
  permitindo reconstruir "essa pergunta de IA → essas tool calls → essa query lenta → esse job" em uma
  única busca de log.
- Dashboards mínimos: latência por rota, taxa de erro por módulo, profundidade de fila por tipo, SLI de §4.1.
- Todo alerta tem dono e canal definidos — não apenas "o Sentry manda um e-mail" (cross-ref §13, Resposta a
  Incidentes).

### 6.2 FinOps: Custo por Organização e Margem

Já existe rastreamento de custo de IA por request (`AIRequest.estimated_cost`) e um cap mensal por organização
verificado pelo `BudgetService` antes de cada chamada. Esta seção estende esse rastreamento para:

- Custo por organização, agregando IA + storage + fila + infraestrutura proporcional (não só custo de IA
  isolado).
- Custo por feature (ex.: quanto custa o pipeline de Revenue Intelligence por lead descoberto — §8).
- Visibilidade de margem bruta por plano (cross-ref §10, Billing & Entitlements).

**Critérios de aceitação:**
- Uma busca por um `trace_id` único retorna todos os eventos (HTTP, IA, tool, query lenta, job, worker) de uma
  única requisição.
- Existe um relatório (gerável sob demanda) de custo total por organização/mês, decomposto por categoria (IA,
  storage, fila).
- Um alerta de SLO (§4.1) violado dispara notificação com dono designado em um tempo mensurável (verificável
  em um exercício de simulação controlada).

---

## 7. Critérios de Extração de Serviços (Scale-Out)

O monolito modular descrito em `PRD.md §10.1` permanece a base. A extração de um módulo em serviço próprio só
acontece quando thresholds objetivos são cruzados — não por preferência estética por microsserviços.

Gatilhos:
- CPU sustentada > 70% por mais de 15 minutos, isolada a um módulo (ex.: worker de embeddings/documentos).
- Latência de fila (BullMQ) p95 acima do SLO daquele job (§4.1) por 3 janelas seguidas.
- Throughput de um endpoint específico dominando mais de 50% do tráfego da API monolítica.
- Deploy de um módulo bloqueando releases dos demais (acoplamento de deployment) mais de uma vez por sprint.
- Necessidade de escalar uma equipe dedicada a um domínio específico (ex.: o pipeline de Revenue Intelligence
  crescendo para um time próprio).

O worker de documentos/IA já é citado em `PRD.md §10.1` como candidato natural a essa extração futura.
Qualquer extração exige contrato de API já estável entre os módulos envolvidos e dados já isolados por
schema/tabelas próprias — a extração não deve criar acoplamento novo no momento em que acontece.

**Critérios de aceitação:**
- Existe um relatório periódico (dashboard ou query) mostrando CPU/latência/throughput por módulo — o gatilho
  é decidido com dado, não opinião.
- Nenhuma extração de serviço ocorre sem um documento de decisão citando qual(is) threshold(s) acima foi(ram)
  cruzado(s).

---

## 8. Pipeline de Revenue Intelligence (Discovery → CRM)

O fluxo de prospecção descrito em `PRD.md §9.1`/Fase 8-9 é formalizado aqui como uma pipeline de estágios
nomeados e explícitos, cada um **idempotente, retomável e observável independentemente**:

```
Discovery → Raw → Normalize → Deduplicate → Enrich → Classify → Score → Opportunity → CRM
```

Cada estágio grava seu próprio status (`pending | running | succeeded | failed | retrying`) e pode ser
reprocessado sem reexecutar os estágios anteriores nem rechamar fontes externas pagas (Apify/Explorium)
desnecessariamente — motivação direta para separar a *intenção* de busca (Discovery) do *resultado bruto* já
capturado (Raw). Outreach permanece uma ação humana-aprovada anexada a um lead pós-Enrich, nunca um estágio
sequencial automático — nenhuma tool de IA aprova ou envia mensagem sozinha (já garantido em `PRD.md §9.1`).

**Mapeamento de referência entre estágio e entidade já existente (`PRD.md §9.1`):**

| Estágio | Entidade hoje | Observação |
|---|---|---|
| (pré-pipeline) | `ServiceOffering` | define o ICP, alimenta o Discovery |
| Discovery | `ScrapeJob` | recomenda-se renomear para `DiscoveryJob` quando o plano da Fase 8 for detalhado — representa a intenção de busca (cidade/tipo/fonte) |
| Discovery (execução) | *(faltante hoje)* | recomenda-se adicionar `ScrapeRun`: uma tentativa de execução de um `DiscoveryJob` contra uma fonte, com `status`/`retry_count`/`idempotency_key` — hoje falta separar "o que buscar" de "essa busca rodou/teve sucesso", o que impede retry seguro sem regastar fonte paga |
| Raw | *(faltante hoje)* | recomenda-se adicionar `RawLead`: payload bruto imutável por hit de fonte, pré-dedup/normalização |
| Normalize / Deduplicate | implícito em `Lead` | sem nova entidade — `RawLead.normalization_status` e `RawLead.deduped_into_lead_id` marcam a conclusão do estágio |
| Enrich | `LeadEnrichment` | já cobre o estágio integralmente |
| Classify | `LeadOpportunity` (Fase 9) | já cobre o estágio — não renomear para "Opportunity" genérico, evita colisão com o estágio abaixo |
| Score | `Lead.score` / `Lead.scoreBreakdown` | já coberto, sem nova entidade |
| Opportunity (handoff comercial) | `Lead.convertedCustomerId` + `LeadOutcomeFeedback` | já coberto — este "Opportunity" (estágio) é distinto de `LeadOpportunity` (classificação de tipo de necessidade) |
| CRM | `Customer` | já coberto via `convertedCustomerId` |
| *(artefato de ação, não estágio)* | `OutreachMessage` | ação humana-aprovada pós-Enrich |

Este mapeamento é uma recomendação para quando o plano detalhado da Fase 8 for escrito — não implica editar
`PRD.md §9.1` como parte deste documento.

**Critérios de aceitação:**
- Reexecutar o estágio `Enrich` para um lead já enriquecido não duplica `LeadEnrichment` nem gera nova chamada
  à fonte externa se o resultado já é válido.
- Uma falha simulada no estágio `Classify` não corrompe nem reprocessa `Score`/`Discovery` — cada estágio é
  testável isoladamente.
- Existe um relatório por execução (dashboard ou log estruturado) mostrando quanto tempo/quantos itens cada
  estágio processou, na ordem correta.

---

## 9. Privacidade e Governança de Dados (LGPD)

### 9.1 Classificação de Dados e Base Legal

Todo dado é classificado por sensibilidade (ex.: dado pessoal de cliente, dado de prospecção pública, dado
financeiro/billing, log de auditoria) e por base legal de tratamento. Para dado de prospecção especificamente
(§8), cada `RawLead`/`Lead` carrega campos concretos — não um `metadata jsonb` genérico:

```
source
collection_timestamp
source_url
collection_basis     (ex.: dado público, legítimo interesse)
data_type
retention_expiry
```

### 9.2 Direitos do Titular

- Fluxo de exportação de dado de um titular (cliente/lead).
- Fluxo de exclusão, respeitando qualquer obrigação legal de retenção — o log de auditoria correspondente é
  anonimizado, não apagado.
- Log de acesso a dado sensível (quem viu o quê, quando), reaproveitando o `AuditLog` já existente, não uma
  tabela paralela.

### 9.3 Subprocessadores e DPA

Lista de subprocessadores que tocam dado pessoal — OpenAI (embeddings), Anthropic (chat), Apify/Explorium
(scraping), Google Cloud Storage — cada um com base contratual (DPA) documentada.

### 9.4 Política de Retenção por Tipo de Dado

Tabela por tipo de dado × estado × prazo, com estados `ativo → soft-deleted → arquivado → apagado
permanentemente`:

| Tipo de dado | Prazo (a calibrar) |
|---|---|
| CRM (cliente/tarefa) | — |
| Documentos | — |
| Logs de auditoria | — |
| `AIRequest` | — |
| Dado bruto de scraping (`RawLead`) | — |
| Outreach | — |
| Analytics agregado | — |

Cada linha recebe um prazo numérico definido antes da implementação — não "conforme necessário".

**Critérios de aceitação:**
- Uma solicitação de exclusão de titular produz um relatório do que foi apagado vs. anonimizado vs. retido por
  obrigação legal, com prazo.
- Um job agendado aplica a política de retenção (§9.4) e move registros vencidos entre estados
  automaticamente — verificável por teste (um registro com `created_at` além do prazo muda de estado após
  rodar o job).
- Todo novo campo de dado pessoal adicionado ao schema passa por um checklist de classificação (§9.1) antes do
  merge.

---

## 10. Billing & Entitlements

Entidades: `Subscription`, `Plan`, `FeatureEntitlement`, `Usage`/`Metering`, `Invoice`, `Payment`, `Webhook`
(do provedor de pagamento), `GracePeriod`, `Suspension`, `Cancellation`.

Tiers: Free / Starter / Growth / Pro / Enterprise, cada um com limites diferentes (número de usuários, budget
de IA — já existe `Organization.ai_monthly_budget` —, número de leads/mês no pipeline de Revenue Intelligence,
storage).

`Organization.plan` (hoje uma string solta) passa a ser uma referência para `Plan`/`Subscription`, com
`FeatureEntitlement` decidindo o que uma organização pode acessar. Isso é distinto de Feature Flag (§11):
entitlement significa "a organização pagou por isso"; flag significa "está liberado gradualmente para essa
organização" — os dois podem coexistir sem se confundir.

Fluxo de inadimplência: `GracePeriod` antes de `Suspension`, `Suspension` antes de `Cancellation`, com
notificação ao usuário em cada transição.

**Critérios de aceitação:**
- Uma organização que excede um limite do seu plano (ex.: número de usuários) recebe um bloqueio previsível na
  ação específica, não um erro genérico — verificável por teste automatizado por tier.
- Um webhook de pagamento falho move a organização por `GracePeriod → Suspension` nos prazos configurados,
  verificável por teste com relógio controlado (fake timers).

---

## 11. Feature Flags e Rollout Gradual

Flags avaliadas por organização (não globais), para rollout incremental de funcionalidades de risco:
`AI_AGENT`, `RAG`, `LEAD_DISCOVERY`, `WHATSAPP`, `ADVANCED_ANALYTICS`.

- Guardadas em uma tabela própria (ex.: `OrganizationFeatureFlag`), avaliadas no mesmo guard chain que já
  resolve `organization_id` (`TenantContextInterceptor`) — evita um segundo ponto de verificação de tenant.
- Permitem desligar uma feature problemática por organização sem deploy (ex.: uma automação gerando custo de
  IA fora do esperado — cruza com o Budget Service e com §6.2).
- Não substituem RBAC: uma flag controla "a feature existe para essa organização"; RBAC continua controlando
  "quem dentro da organização pode usá-la".

**Critérios de aceitação:**
- Desligar uma flag para uma organização específica bloqueia o acesso à feature nessa organização em menos de
  1 request (sem deploy) e não afeta outras organizações — verificável por teste cross-tenant.
- Toda feature nova classificada como "risco" (IA, integrações externas) nasce atrás de uma flag, comprovável
  por um checklist de PR.

---

## 12. Prontidão Enterprise (Roadmap)

Explicitamente roadmap, não escopo atual — cada item referencia de qual seção "v1" deste documento ele evolui:

| Item | Evolui de |
|---|---|
| SSO/SAML | §2.1 (Identidade e Sessão) |
| SCIM | §2.1 |
| MFA v2 (TOTP + recovery codes) | §2.1 |
| Exportação de auditoria | `AuditLog` já existente |
| Residência de dados | §9 (Privacidade e Governança) |
| Retenção customizável por cliente | §9.4 |
| IP allowlisting | §2.2 |
| Customização de papel além dos 5 padrão | RBAC atual (`PRD.md §14`) |
| API keys para integração | §2.2 |
| Webhooks de saída | §2.2 |
| Limites de uso configuráveis por contrato | §10 (Billing & Entitlements) |
| Ambientes dedicados | §4 (Confiabilidade) |

**Critérios de aceitação:**
- Cada item desta lista tem um critério de "pronto para vender" definido (ex.: SSO — um cliente enterprise
  consegue configurar seu próprio IdP sem suporte manual) antes de entrar em sprint — não apenas o nome da
  feature.

---

## 13. Resposta a Incidentes

Severidades objetivas:

| Severidade | Definição |
|---|---|
| SEV-1 | Indisponibilidade total, ou vazamento de dado cross-tenant confirmado |
| SEV-2 | Degradação significativa de uma função crítica (ex.: IA fora do ar, fila travada) |
| SEV-3 | Degradação parcial, com contorno disponível |
| SEV-4 | Degradação cosmética, sem impacto funcional |

Fluxo: `Alerta → Incidente declarado → Mitigação → Recuperação → Postmortem → Itens de ação`. Postmortem sem
culpa individual, focado em causa raiz e no controle que faltou — referenciando a Modelagem de Ameaças (§3)
quando aplicável. Todo SEV-1/SEV-2 gera um postmortem em prazo definido (ex.: 5 dias úteis), com itens de ação
rastreados até o fechamento.

**Critérios de aceitação:**
- Existe um runbook testado (simulação/*game day*) para pelo menos um cenário SEV-1 (ex.: vazamento
  cross-tenant simulado), com tempo de detecção→mitigação medido.
- Todo incidente SEV-1/SEV-2 fechado tem um postmortem rastreável com itens de ação e dono; uma auditoria
  trimestral confirma quantos itens de ação foram de fato fechados.

---

## 14. Mapeamento para Roadmap Futuro

As seções acima não têm sprint atribuído neste documento — a quebra formal em sprints e o Technical Master
Plan são um passo posterior e separado. Como referência de onde cada domínio tende a entrar no Roadmap por
Fases do `PRD.md §17` (Fases 10 em diante, após a conclusão das Fases 8-9 de Revenue Intelligence):

| Domínio | Fase futura sugerida |
|---|---|
| §1 Zero Trust, §2.6 Suíte de Isolamento de Tenant, §3 Threat Model | Fase 10 — Security Hardening |
| §2.1–§2.5 (Identidade, Autorização, Segurança de IA, Policy Engine, Segredos) | Fase 10-11 — Security Hardening / Identity |
| §4 Confiabilidade, §5 Supply Chain, §6 Observabilidade/FinOps | Fase 12 — Reliability & Observability |
| §7 Critérios de Scale-Out | avaliado continuamente, sem Fase própria |
| §8 Pipeline de Revenue Intelligence (estágios) | integrado à Fase 8-9 já em andamento |
| §9 Privacidade/LGPD | Fase 13 — Compliance & Data Governance |
| §10 Billing & Entitlements, §11 Feature Flags | Fase 14 — Monetização |
| §12 Prontidão Enterprise | Fase 15+ — Enterprise (sob demanda de cliente) |
| §13 Resposta a Incidentes | Fase 10 — Security Hardening (junto com §1) |

---

## Nota sobre pendência conhecida

O `PRD.md` (§7 e §9.1) referencia `docs/superpowers/plans/2026-09-02-leads-prospecting-dashboard.md` como o
plano detalhado da Fase 8/9 — este arquivo ainda não existe no repositório. A criação desse plano é um passo
separado, fora do escopo deste documento; a recomendação de entidades em §8 (`DiscoveryJob`, `ScrapeRun`,
`RawLead`) deve ser considerada quando esse plano for escrito.
