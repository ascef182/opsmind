# Security Review — OpsMind PRD v1.0

**Revisor:** security-reviewer (subagente)
**Escopo:** `docs/planning/PRD.md` — foco nas seções 8 (Regras de Negócio), 10.3 (Camada de IA / Tool Calling) e 14 (Segurança), com leitura completa do documento.
**Natureza da revisão:** análise de design/arquitetura em nível de PRD. Não há código-fonte no repositório ainda (só o PRD e os agentes em `.claude/agents/`); portanto os achados abaixo são sobre o **desenho** proposto, não sobre uma implementação concreta. Recomenda-se repetir esta revisão (com foco em código) ao final da Fase 1 e novamente ao final da Fase 3 (IA/Tool Calling).

---

## Resumo

O PRD tem uma postura de segurança acima da média para um MVP: já nasce com isolamento multi-tenant como regra de negócio explícita, RBAC aplicado tanto a rotas HTTP quanto a tools de IA, defesa contra prompt injection tratando documentos como dado, auditoria de ações da IA e URLs assinadas para storage. Esses são os pilares certos.

Dito isso, o desenho tem lacunas que, se não endereçadas antes ou durante a Fase 1/Fase 3, tendem a virar vulnerabilidades reais justamente nos pontos que o próprio PRD elege como diferencial do projeto (isolamento de tenant e segurança de IA):

1. **O isolamento por `organization_id` depende só da camada de aplicação** ("idealmente reforçado" — linguagem não mandatória) e **duas entidades do modelo de dados (`DocumentChunk`, `AutomationRun`) não carregam `organization_id` diretamente**, exigindo join correto em toda query — inclusive nas buscas vetoriais do RAG, que são justamente as mais fáceis de errar. Isso é o vetor mais provável de vazamento cross-tenant via IA.
2. **Nada garante que o `organization_id`/usuário ativo usado pelas tools de IA venha só da sessão autenticada no servidor**, e não de um parâmetro controlável pelo cliente ou (pior) sugerido pelo próprio modelo de linguagem — combinado com prompt injection, isso é o caminho mais direto para o cenário que o PRD quer evitar por definição (caso de uso 7: "um PDF malicioso não pode vazar dados de outro cliente").
3. **RBAC está descrito em nível de hierarquia de papéis, não de matriz de permissões** (quem pode fazer o quê, sobre qual recurso, via qual tool) — isso deixa ambíguo, por exemplo, se Member/Viewer podem disparar tools de escrita, e como o Viewer é limitado a um "subconjunto" de dados.
4. **Revogação de sessão/JWT não é tratada**: mudança de papel, remoção de membro ou troca de senha não invalidam tokens já emitidos até expirarem.
5. **SSRF em processamento de PDF não é mencionado** — parsers de PDF frequentemente resolvem recursos externos, e em GCP isso pode alcançar o metadata endpoint interno.

O checklist de Fase 1 no final deste documento traduz os pontos críticos/altos em itens acionáveis para o sprint de Foundation, onde a maioria pode ser resolvida com baixo custo (constraints de schema, guard central, RLS, testes de isolamento em CI).

---

## Riscos por Severidade

### CRÍTICO

**C1 — `DocumentChunk` e `AutomationRun` não têm `organization_id` próprio no modelo de dados**
- **Onde:** Seção 9 (Modelo de Dados) — `DocumentChunk { id, document_id, content, embedding, chunk_index }` e `AutomationRun { id, automation_id, status, triggered_by, result, created_at }`.
- **Risco:** para filtrar por tenant, toda query nessas tabelas precisa fazer join até `Document`/`Automation` para chegar em `organization_id`. A busca por similaridade vetorial do RAG (`pgvector`) é exatamente o tipo de query que tende a ser escrita como "top-K por distância de embedding" sem o WHERE de tenant explícito — um único endpoint, worker ou query de debug que esqueça o join vaza chunks de documentos de outra organização para dentro do contexto da IA, que depois os cita na resposta. Isso quebra diretamente o critério de aceitação #3 e o caso de uso #7 do PRD.
- **Recomendação:** denormalizar `organization_id` em `DocumentChunk` e `AutomationRun` (e em qualquer tabela filha usada em busca/agregação — copiar a FK do pai no `INSERT`, não derivar por join). Isso também é pré-requisito para a recomendação C2 (RLS), que precisa da coluna presente na própria tabela para funcionar sem reescrever a política a cada join.

**C2 — Isolamento de tenant é só de aplicação; falta Row Level Security no Postgres como camada independente**
- **Onde:** Seção 8 ("reforçado na camada de acesso a dados, não só na aplicação") e Seção 14 ("idealmente reforçado por uma camada/guard central, não deixado a critério de cada desenvolvedor lembrar") — a própria redação usa "idealmente", ou seja, é uma convenção recomendada, não uma garantia estrutural.
- **Risco:** um guard/interceptor central do NestJS é necessário, mas é uma única camada, escrita por humanos, que cobre "rotas". Não cobre automaticamente: queries feitas por workers (BullMQ), scripts administrativos, migrations com seed de dados, uma nova rota que algum dev esqueça de anotar com o guard, ou uma query Prisma "raw" usada para uma feature de analytics. Em um projeto multi-tenant, esse é historicamente o vetor #1 de vazamento de dados entre clientes (IDOR "vertical" de tenant).
- **Recomendação:**
  - Ativar **Postgres Row Level Security** em todas as tabelas com `organization_id`, com policy baseada em `current_setting('app.current_org_id')` setado por transação/conexão a partir do JWT validado no início de cada request (ex.: via middleware do Prisma/pg que faz `SET LOCAL app.current_org_id = $1` dentro da mesma transação da query).
  - Isso vira uma **camada de defesa em profundidade que funciona mesmo se o guard de aplicação falhar ou for esquecido** — inclusive para workers e scripts, desde que também setem o contexto de sessão.
  - Manter o guard de aplicação como primeira linha (melhor UX de erro, menos round-trip), mas RLS como backstop obrigatório, não opcional.
  - Adicionar teste automatizado de CI que tenta ler/escrever dado de outro tenant diretamente contra o banco (bypassando a API) para provar que a RLS está ativa — não só testar via API.

**C3 — Tools de IA podem ficar vulneráveis a receber `organization_id`/identificadores de recurso "sugeridos" pelo modelo em vez de derivados da sessão**
- **Onde:** Seção 10.3 diz que cada tool é "já filtrada por `organization_id` e pelo papel do usuário que iniciou a conversa", mas não especifica **de onde** vem esse `organization_id` no momento da execução da tool — se é injetado pelo backend a partir da sessão autenticada, ou se pode, ainda que indiretamente, ser influenciado por texto que o LLM gerou (ex.: o modelo decide os argumentos da tool call, e se o schema da tool aceitar um campo `organization_id` ou `customer_id` sem revalidação contra a sessão, um documento com prompt injection pode tentar induzir o modelo a chamar `search_documents({ customer_id: <de outro tenant> })`).
- **Risco:** é exatamente o cenário do caso de uso #7 e do critério de aceitação #7 do próprio PRD. Sem esse controle explícito, a defesa "documento é dado, não instrução" fica sem uma segunda camada — se a barreira de prompt injection falhar (e ela vai falhar eventualmente, é probabilístico, não determinístico), não há nada impedindo a tool de executar fora do tenant.
- **Recomendação:**
  - Nenhuma tool deve aceitar `organization_id`, `user_id` ou qualquer claim de identidade/tenant como argumento vindo do modelo. Esses valores devem ser **injetados pelo executor de tools no backend**, a partir do contexto de sessão autenticado, e qualquer valor equivalente que o modelo tente passar deve ser ignorado/sobrescrito, nunca mesclado.
  - Todo `resource_id` (ex.: `customer_id`) que a tool recebe do modelo deve ser revalidado contra `organization_id` da sessão antes de executar a query (mesmo que a query também tenha RLS — validar cedo dá erro melhor e reduz superfície).
  - Documentar esse contrato explicitamente como parte do "contrato de permissões" de tool citado na seção 10.3.

**C4 — Contexto de organização ativa não pode depender de valor enviado pelo cliente sem revalidação server-side**
- **Onde:** Seção 8 menciona troca de contexto entre organizações "sem misturar dados entre elas na mesma sessão", mas não especifica o mecanismo técnico.
- **Risco:** se a implementação usar um header/parâmetro (`X-Org-Id`, query param, campo de body) para indicar "qual organização estou operando agora", e o backend confiar nesse valor apenas checando se o usuário *pertence* à org (sem revalidar a cada request contra uma claim assinada), abre-se espaço para um usuário legítimo de duas orgs (ou um bug de frontend) misturar contexto, e mais grave, para replay/manipulação de request forjando esse valor.
- **Recomendação:** o token de sessão (JWT de acesso) deve carregar `organization_id` + `role` como claims assinadas, específicas da membership ativa. Trocar de organização = reautenticar/reemitir token para aquela membership (endpoint dedicado, ex. `POST /auth/switch-organization`, que reemite um novo access token). O backend nunca deve aceitar `organization_id` fora do claim assinado para decidir escopo de dados.

---

### ALTO

**A1 — RBAC descrito como hierarquia de papéis, sem matriz de permissões granular**
- **Onde:** Seções 6, 8, 14 — citam "5 papéis" e ordenação `Owner > Admin > Manager > Member > Viewer`, mas não há uma matriz explícita de permissões por recurso/ação (customers, tasks, documents, automations, audit-logs, tools de IA).
- **Risco:** implementação inconsistente entre módulos (um dev decide que Member pode excluir task, outro que não); ambiguidade sobre se Viewer pode de fato invocar `/ai/chat` e, se sim, com quais tools disponíveis (ler é diferente de "ver um subconjunto" — o PRD já reconhece que Viewer vê só "um subconjunto de dados" na seção 3, sem definir o critério desse subconjunto).
- **Recomendação:** antes do fim da Fase 1, produzir uma matriz papel × recurso × ação (create/read/update/delete) × tool de IA, incluindo explicitamente: quem pode convidar com qual papel (crítico para não permitir que um Manager convide um Owner — escalonamento de privilégio via convite), e qual o critério exato do "subconjunto" visível ao Viewer (por cliente atribuído? por tag? tudo, exceto financeiro?). Codificar essa matriz como dado (não só como comentário), para que o guard central e os testes de autorização leiam da mesma fonte.

**A2 — Ausência de revogação/invalidação de sessão para JWT**
- **Onde:** Seção 14 — "JWT de curta duração + refresh token" é mencionado, mas nada sobre invalidação antes da expiração natural.
- **Risco:** remoção de um membro da organização, downgrade de papel, ou troca de senha por suspeita de comprometimento não revogam tokens de acesso já emitidos — o usuário/atacante continua com o nível de acesso antigo até o access token expirar (e, se o refresh token continuar válido, indefinidamente).
- **Recomendação:** manter uma tabela de refresh tokens (ou sessions) no banco, com possibilidade de revogação; ao remover membership, trocar papel ou trocar senha, revogar todos os refresh tokens da sessão/usuário afetado; manter o access token realmente curto (ex.: 10–15 min) para limitar a janela de privilégio obsoleto mesmo sem revogação ativa de access tokens (que normalmente são stateless).

**A3 — Estratégia de armazenamento de token no cliente e CSRF não definidas**
- **Onde:** Não mencionado em nenhuma seção, apesar da stack ser Next.js + NestJS.
- **Risco:** se o refresh token (ou o próprio access token) for guardado em `localStorage`, fica exposto a XSS. Se for guardado em cookie, é preciso `httpOnly` + `Secure` + `SameSite` e proteção CSRF explícita em endpoints que mudam estado.
- **Recomendação:** definir explicitamente: access token em memória (não persistido) ou cookie `httpOnly`/`Secure`/`SameSite=Strict`; refresh token só em cookie `httpOnly`; se cookies forem usados, implementar defesa CSRF (double-submit token ou `SameSite=Strict` combinado com verificação de origem) desde a Fase 1.

**A4 — SSRF no pipeline de processamento de documentos não é considerado**
- **Onde:** Seção 6/13 — upload de PDF, extração de texto; Seção 14 não menciona esse vetor.
- **Risco:** bibliotecas de parsing de PDF podem seguir referências externas (links, fontes remotas, XFA/JavaScript embutido, formulários). Se o worker de extração rodar em ambiente com acesso à rede interna/GCP metadata endpoint (`169.254.169.254`), um PDF malicioso pode ser usado para SSRF, incluindo exfiltração de credenciais de service account do GCP.
- **Recomendação:** usar biblioteca de extração que não execute JavaScript embutido nem resolva recursos externos (ou rodar com essas capacidades explicitamente desabilitadas); processar em worker isolado sem acesso à rede interna/metadata (egress bloqueado por padrão, allowlist só para o storage necessário); validar `Content-Type`/magic bytes do upload (não confiar na extensão); impor limite de tamanho e proteção contra "decompression/PDF bomb" (objetos aninhados profundos).

**A5 — Orçamento de IA sem enforcement síncrono no MVP**
- **Onde:** Seção 9 já modela `Organization.ai_monthly_budget`, mas a Seção 7 (Funcionalidades Futuras) coloca "Orçamento de IA por organização com alertas e corte automático" como **pós-MVP**.
- **Risco:** o campo existe no schema desde o MVP, criando a expectativa de proteção, mas sem corte automático não há nada impedindo um usuário (ou uma automação em loop, ou um ataque que force muitas chamadas de IA) de gerar custo ilimitado com o provider de IA — isso é tanto um risco financeiro quanto um vetor de DoS de custo.
- **Recomendação:** mesmo no MVP, implementar um check síncrono simples (contador de custo acumulado do mês em Redis, incrementado a cada `AIRequest`, comparado ao `ai_monthly_budget` antes de permitir nova chamada) que bloqueia/degrada com erro claro ao ultrapassar o teto — não precisa ser o painel completo de alertas da Fase 7, só o corte automático "burro".

**A6 — Rate limiting mencionado só genericamente, sem alvos específicos**
- **Onde:** Seção 14 — "rate limiting" citado uma vez, sem detalhar endpoints.
- **Risco:** sem limites dedicados, os pontos mais sensíveis a abuso ficam implicitamente desprotegidos: `/auth/login` (brute force de senha), `/auth/register` e reset de senha (enumeração de e-mail, spam), `/organizations/:id/invite` (spam de convites), `/ai/chat` (custo e exfiltração em massa via tool calls repetidos), `/documents` upload (abuso de storage/custo de processamento).
- **Recomendação:** listar explicitamente limites por endpoint (ex.: 5 tentativas de login/15 min por IP+conta com backoff exponencial; throttle de custo por usuário em `/ai/chat` além do limite por organização; limite de convites por hora por organização) já como parte do critério de "pronto" da Fase 6, mas idealmente aplicado desde a Fase 1 para auth.

**A7 — Testes de prompt injection limitados a um único cenário no eval suite**
- **Onde:** Seção 13/14 — menciona "um teste automatizado" com o exemplo clássico "ignore previous instructions..." embutido em documento.
- **Risco:** um único caso de teste não cobre a superfície real de prompt injection: injeção via campos de CRM/notas (não só documentos), injeção fragmentada entre múltiplos `DocumentChunk` (para escapar de um filtro que só olha um chunk por vez), injeção via nome de arquivo/metadados do PDF (se esses campos forem ecoados em algum prompt), injeção multi-turno (payload que só "ativa" depois de round-trips), tentativas de manipular argumentos de tool (ver C3), e uso de unicode/homoglyphs para evadir filtros de string simples.
- **Recomendação:** expandir o dataset de evals de segurança para uma matriz mínima de casos (documento, campo de CRM, nome de arquivo, multi-turno, manipulação de argumento de tool, fragmentação entre chunks), rodada em CI a cada mudança no AI Module — não só como demo pontual na Fase 7.

**A8 — Modelo de privilégio de Automações não é definido (risco de "confused deputy")**
- **Onde:** Seção 9 — `Task.created_by` aceita `automation` como ator; Seção 10.4 descreve o motor de trigger→condição→ação.
- **Risco:** não fica claro sob qual identidade/papel uma automação executa suas ações. Se uma automação criada por um Member continuar rodando com o nível de acesso do momento da criação mesmo depois de o Member ser rebaixado ou removido da organização, isso é um "confused deputy": a automação vira um caminho para manter privilégio que o humano já perdeu.
- **Recomendação:** definir que toda execução de automação reavalia a autorização no momento do disparo (não no momento da criação) — idealmente vinculada à organização como entidade, com um conjunto de permissões próprio e auditável, e não "herdando" silenciosamente o papel do criador original. No mínimo, revalidar que o criador ainda é membro ativo da organização com papel suficiente antes de cada execução.

---

### MÉDIO

**M1 — Falta de MFA para papéis privilegiados**
Owner/Admin têm acesso a configuração de RBAC, integrações e potencialmente dados de todos os clientes da organização. Não há menção de segundo fator. Recomenda-se pelo menos oferecer TOTP opcional para Owner/Admin, e considerar obrigatório em fase futura.

**M2 — Rotação e detecção de reuso de refresh token não mencionadas**
Um refresh token roubado, sem rotação, pode ser usado indefinidamente até expirar. Recomenda-se rotação a cada uso (refresh token de uso único, reemitido a cada refresh) com detecção de reuso (se um token já usado for apresentado novamente, revogar toda a família de tokens daquela sessão — sinal de possível roubo).

**M3 — Escopo de acesso antes da verificação de e-mail não definido**
Não fica claro se um usuário com e-mail não verificado pode convidar outros membros, criar dados ou só existe em estado "pendente". Recomenda-se bloquear ações sensíveis (convidar, criar organização, operações de escrita) até a verificação.

**M4 — Validação do fluxo de convite não detalhada**
Não é explícito se o token de convite é de uso único, vinculado ao e-mail convidado (para impedir que o link seja aceito por conta diferente da convidada) e gerado com entropia adequada. Recomenda-se: token aleatório criptograficamente forte, single-use, validação de que o e-mail da conta que aceita corresponde ao e-mail convidado (ou pelo menos alerta se divergir).

**M5 — Validação de arquivo enviado (upload de documentos) não detalhada além do formato PDF**
Falta menção a: verificação de MIME/magic bytes (não confiar na extensão), scanning antimalware, limite de tamanho, e proteção contra arquivos corrompidos/bombas de descompressão que possam derrubar o worker de processamento.

**M6 — Padrão de verificação de posse do recurso (IDOR) não explicitado para endpoints com `:id`**
Endpoints como `GET /customers/:id`, `PATCH /tasks/:id`, `GET /documents/:id` dependem de checar não só "o usuário está autenticado" e "pertence à organização X", mas que **o recurso `:id` específico também pertence à organização X** antes de qualquer leitura/escrita — isso é distinto do isolamento geral por tenant e precisa ser um padrão consistente (idealmente centralizado no mesmo guard/decorator, não reimplementado em cada controller). Recomenda-se aplicar a skill `idor-protection` disponível no projeto como checklist de implementação para cada endpoint com identificador de recurso.

**M7 — Falta de guardrail de saída (output) na resposta da IA como camada adicional**
A defesa descrita é toda de entrada (tratar documento como dado). Não há menção a uma verificação, ainda que leve, sobre a resposta gerada antes de devolvê-la ao usuário (ex.: heurística que sinaliza se a resposta referencia um `customer_id`/`document_id` fora do conjunto retornado pelas tools daquela conversa) — útil como defesa em profundidade contra bugs sutis de retrieval, não só contra injection.

**M8 — Falta de limite de quantidade/custo de tool calls por turno de conversa**
Sem um teto de tool calls por mensagem/conversa, um prompt comprometido (via injection) poderia encadear muitas chamadas de `search_customers`/`search_documents` para extrair grande volume de dados através das respostas do chat. Recomenda-se paginação obrigatória nos resultados de tools de busca e um orçamento máximo de tool calls por turno.

**M9 — Pipeline de CI/CD (Fase 6) não menciona SCA/SAST**
A Seção 17 (Fase 6) lista Docker, CI/CD, deploy, Terraform, rate limiting, Sentry — mas não `npm audit`/Dependabot/Snyk nem análise estática de segurança (ex. `eslint-plugin-security`, Semgrep) como gate do pipeline. Recomenda-se adicionar como critério de "pronto" da Fase 6.

**M10 — Imutabilidade do `AuditLog` e controle de acesso a `/audit-logs` não são explícitos**
"Log imutável" é citado como princípio (seção 8), mas não há menção de como isso é garantido tecnicamente (permissões de banco que impeçam `UPDATE`/`DELETE` mesmo para o papel de aplicação, ou réplica append-only) nem de quem pode consultar `GET /audit-logs` (presumivelmente Owner/Admin, mas não está na matriz de permissões).

---

### BAIXO

**B1 — Política de senha não especificada** (comprimento mínimo, verificação contra vazamentos conhecidos tipo HaveIBeenPwned).

**B2 — Headers de segurança / CSP no frontend Next.js não mencionados** (X-Frame-Options, CSP, X-Content-Type-Options via `helmet`/config do Next).

**B3 — LGPD/GDPR: direitos do titular de dados não endereçados** — dado que `Customer` armazena PII de terceiros (nome, e-mail, telefone) e o produto tem clientes no Brasil, considerar (mesmo que só documentado, não implementado no MVP) como exportação/exclusão de dados pessoais a pedido do titular se encaixaria no fluxo de soft-delete/hard-delete já existente.

**B4 — Criptografia em repouso descrita de forma genérica** — "dados sensíveis criptografados em repouso" (seção 14) provavelmente cobre disco (padrão GCP), mas não define se algum campo específico (ex.: conteúdo de documento, notas de cliente) merece criptografia a nível de coluna adicional.

**B5 — Retenção de dados de `AIRequest` e possível PII em prompts logados** — prompts/respostas de IA frequentemente contêm dados de clientes; se forem armazenados para observabilidade/evals, definir retenção e controle de acesso equivalente ao dos dados originais.

**B6 — Soft-delete não menciona explicitamente exclusão do índice de retrieval** — ao soft-deletar um cliente ou documento, confirmar que `DocumentChunk`s e dados de CRM associados param de ser retornados pela busca semântica/tools da IA, não só pelas rotas CRUD comuns.

---

## Checklist de Segurança para a Fase 1 (Foundation)

Sprints 1–2: Monorepo, Docker Compose, Prisma + schema inicial, Auth (registro/login/refresh), Organizations + Membership + RBAC básico, Audit log mínimo.

**Schema e isolamento de tenant**
- [ ] `organization_id` presente e obrigatório (FK `NOT NULL`) em toda tabela que precisa dele — incluir desde já em `DocumentChunk` e `AutomationRun` (denormalizado, não só via join) mesmo que esses módulos só cheguem nas Fases 3–5 (evita migration dolorosa depois).
- [ ] Row Level Security habilitada em todas as tabelas com `organization_id`, policy baseada em variável de sessão setada a partir do JWT validado.
- [ ] Middleware/extension do Prisma que injeta automaticamente o filtro de `organization_id` em toda query dos módulos (não depender de cada developer lembrar).
- [ ] Teste de CI que cria 2 organizações e prova que usuário da org A não consegue ler/escrever dado da org B por nenhuma rota exposta na Fase 1 (login, customers básico se já existir, memberships) — reflete o critério de aceitação #1 do PRD.

**Autenticação**
- [ ] Hash de senha com bcrypt (custo ≥ 12) ou argon2id.
- [ ] Access token JWT curto (10–15 min), claims incluindo `user_id`, `organization_id` ativo e `role` da membership.
- [ ] Refresh token opaco, armazenado no banco (tabela de sessions/refresh tokens), com rotação a cada uso e detecção de reuso (revoga família inteira em caso de reuso de token já consumido).
- [ ] Revogação de sessão implementada: logout, troca de senha, remoção de membership e mudança de papel invalidam refresh tokens ativos daquele usuário/sessão.
- [ ] Token storage definido e documentado (recomendado: access token em memória no client + refresh token em cookie `httpOnly`/`Secure`/`SameSite=Strict`); proteção CSRF se cookies forem usados.
- [ ] Verificação de e-mail obrigatória antes de liberar ações de escrita/convite; resposta de erro genérica em login/registro/reset (não revelar se e-mail existe).
- [ ] Fluxo de reset de senha: token single-use, expiração curta (≤ 60 min), invalidado após uso.
- [ ] Endpoint `switch-organization` explícito que reemite token para a membership escolhida — nunca aceitar `organization_id` de header/param do cliente como fonte de verdade.
- [ ] Rate limiting em `/auth/login`, `/auth/register`, `/auth/refresh` e reset de senha (por IP e por conta), com backoff/lockout progressivo.

**RBAC**
- [ ] Matriz papel × recurso × ação documentada (mesmo que mínima na Fase 1, cobrindo Organizations/Membership) antes de generalizar para os módulos futuros.
- [ ] Guard de autorização central aplicado por padrão a toda rota nova (deny-by-default); rota pública exige anotação explícita, não o contrário.
- [ ] Regra de convite: só Owner/Admin convidam, e nunca com papel igual ou superior ao do próprio convidador (evitar Manager convidando Owner).
- [ ] Convite: token aleatório forte, single-use, expira em 7 dias (conforme PRD), validação de e-mail no aceite.

**Auditoria**
- [ ] `AuditLog` append-only a nível de permissão de banco (papel de aplicação sem `UPDATE`/`DELETE` na tabela).
- [ ] Cobertura mínima da Fase 1: login, criação de organização, convite, aceite de convite, mudança de papel, remoção de membro.
- [ ] Acesso de leitura a `/audit-logs` restrito a Owner/Admin (registrar isso já na matriz de RBAC acima).

**Infraestrutura básica**
- [ ] Segredos (DB, JWT signing key) via `.env`/secret manager, nunca commitados; `.env.example` só com placeholders; scanning de secrets no pre-commit/CI desde o primeiro commit.
- [ ] CORS com allowlist explícita de origem (sem wildcard) mesmo em ambiente de desenvolvimento compartilhado.
- [ ] `helmet` (ou equivalente) habilitado no NestJS desde o primeiro deploy, com headers básicos de segurança.
- [ ] Validação de input (Zod/class-validator) em 100% dos DTOs desde o primeiro endpoint, não retrofitada depois.
- [ ] HTTPS/HSTS mesmo em ambiente de staging inicial.

---

*Fim da revisão. Recomenda-se nova passagem do security-reviewer ao final da Fase 3 (AI Assistant + Tool Calling) com foco específico nos riscos C3, C4, A7 e A8 acima, já contra código real.*
