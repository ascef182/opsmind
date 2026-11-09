# OpsMind — Diagnóstico Harvey e Evolução do Módulo de Prospecção para "Inteligência Comercial"

**Data:** 2026-11-06
**Método:** engenharia reversa direta do código-fonte do projeto open source [`ethanplusai/harvey`](https://github.com/ethanplusai/harvey) (MIT), combinada com leitura/verificação direta do código real do OpsMind (schema Prisma, serviços de `apps/api/src/modules/leads`, worker de scraping, gateways de integração, frontend, docs de planejamento existentes). Nenhum código deste repositório foi alterado para produzir este diagnóstico.
**Natureza:** este documento é uma recomendação de arquitetura e um roadmap, não uma decisão já implementada. É o registro formal de uma investigação feita a pedido do usuário antes de qualquer código ser escrito para esta feature.

---

## 1. Resumo executivo / Recomendação final

Reaproveitar o Harvey em duas camadas diferentes, com dois tratamentos diferentes (**Opção C**, decisão
detalhada na seção 3), e não um "tudo ou nada" sobre código vs. ideia:

- **Lógica pura e autocontida — porta-se o código mesmo, traduzido Python→TypeScript, não só a ideia**:
  a fórmula de scoring (`fit.py`), a lista de frases proibidas (`gate.py BANNED_PHRASES`), os padrões de
  extração por regex do profiler de site (`profile.py`), e as regras estruturais do prompt de outreach
  (`prompts/writer.md`/`skills/email_frameworks.md`). A licença MIT permite isso sem restrição. Ver a
  tabela da seção 3.1 com arquivo-fonte → arquivo-destino lado a lado.
- **Camada de estado/execução — não se porta mesmo com licença livre, por razões técnicas e legais, não
  de estilo**: o schema SQLite single-tenant, o loop de orquestração assumindo um único processo com
  acesso exclusivo a um arquivo, e principalmente o runtime de execução via CLI/assinatura pessoal do
  Claude ou ChatGPT. Isso não dá para "portar", porque o problema não é a linguagem — é que a premissa
  inteira (um único operador, uma assinatura pessoal, um arquivo local) não existe em um SaaS
  multiempresa. Detalhe legal na seção 2.

O OpsMind já implementa, de forma independente, boa parte da filosofia de segurança do Harvey (aprovação
humana obrigatória, scoring determinístico, defesa de prompt injection no prompt de outreach) — o
trabalho real é portar o código pontual que falta (sinais estruturados com evidência/confiança, portão
determinístico de frases genéricas antes do envio, regex de investigação de site) para dentro dos
arquivos TypeScript certos, não reconstruir do zero nem rodar o Harvey como programa separado.

---

## 2. Diagnóstico do Harvey (engenharia reversa)

- **Arquitetura real**: não é um framework multiagente — é um loop determinístico único
  (`main.decide_next_action`) que escolhe 1 ação por ciclo contando linhas no SQLite
  (`responder > enviar campanhas > escrever campanhas > prospectar > idle`). Os "5 agentes" (Scout,
  Writer, Sender, Handler, Analyst) são 5 classes Python compartilhando um banco só, sem troca de
  mensagens entre si — comunicam-se via estado no banco, nunca diretamente.
- **Ideia #1 — modelo de observações**: todo fato descoberto é uma linha em `observations`
  (empresa/contato, código do sinal, valor, confiança, URL-evidência, data, run) — nunca uma coluna.
  Vocabulário de sinais é governado (`signal_codes`, status proposto→confirmado) e um trigger no banco
  rejeita códigos não cadastrados. Benefícios: nenhuma migração por novo tipo de sinal, histórico/série
  temporal de graça, confiança e proveniência viajam junto com o fato, e uma coorte-alvo se torna um
  `WHERE` sobre linhas de observação.
- **Ideia #2 — scoring determinístico e explicável**: função pura 0–100 por buckets (setor, decisor
  alcançável, sinal de compra, qualidade do dado), sempre com motivo legível por ponto, nunca IA/ML.
- **Ideia #3 — anti-texto-genérico em duas camadas**: regras de estrutura no prompt (gancho real → custo
  concreto → oferta objetiva → 1 CTA) **mais** um portão determinístico no código com lista de frases
  proibidas que bloqueia o envio mesmo se o modelo ignorar o prompt — "regra no prompt é piso, não
  garantia."
- **Ideia #4 — aprovação humana com portão duplo**: mesmo no modo autopilot (opt-in), um portão
  determinístico roda antes de qualquer envio (links fora do domínio, vazamento do próprio prompt, tags
  não substituídas, excesso de palavras/links, rodapé de compliance ausente).
- **Ideia #5 — defesa de prompt injection**: todo texto de origem externa (site raspado, resposta de
  email) é cercado (`fence()`) com instrução explícita de tratar como dado, nunca instrução, incluindo
  neutralização de tentativas de "escapar" da cerca.
- **Alerta crítico de licenciamento/legal**: a execução de modelo do Harvey roda sobre a **assinatura
  pessoal** do operador (login de CLI do Claude Pro/Max ou ChatGPT Plus/Pro, nunca API paga por token).
  Esse padrão é de uso único (single-tenant, local) e **não é portável para um SaaS multiempresa**:
  revender/multiplexar uma assinatura pessoal entre clientes pagantes provavelmente viola os Termos de
  Serviço de consumidor da Anthropic/OpenAI. **Recomendação: não importar esse padrão.** O OpsMind já usa
  o modelo correto (cobrança via API, `ANTHROPIC_API_KEY`, por token) — mantê-lo.
- **O que descartar sem dó**: automação de LinkedIn (o próprio Harvey admite violar os Termos de Uso do
  LinkedIn), integração legada com Instantly.ai (caminho de aprovação pior que o nativo), descoberta via
  OpenStreetMap isolado (cobertura fraca), presets de nicho para startups, e todo o modelo operacional
  local/arquivo único (SQLite, config em disco, token de dashboard em arquivo) — é single-tenant por
  construção, não dá para "estender" para multiempresa, só reconstruir.
- **Licença**: MIT, sem condições de reuso além de manter o aviso de copyright em trechos de código
  efetivamente copiados literalmente.

---

## 3. Arquitetura proposta: comparação A/B/C e decisão

**A — integrar os módulos do Harvey diretamente.** Descartado. Incompatibilidade de linguagem
(Python/SQLite vs. NestJS/TypeScript/Prisma/Postgres) torna "integração direta" impossível sem na
prática virar a opção B disfarçada; o modelo de dados do Harvey não tem `organizationId` em lugar
nenhum — portar verbatim exigiria reescrever toda query para multiempresa, ou seja, não seria mais
"integração", seria reescrita; e o requisito do próprio usuário de não copiar código do produto inteiro
já descarta esta opção por definição.

**B — Harvey como serviço independente, conectado via API.** Descartado. Criaria uma segunda fonte de
verdade para `Lead`/`OutreachMessage`/`ServiceOffering` (duplicação + necessidade de um job de
sincronização que não existe e seria, ele mesmo, uma nova superfície de falha) — o que viola em espírito
o "não quero dois dashboards" mesmo que a UI pareça única. A garantia de isolamento multiempresa do
OpsMind (RLS do Postgres via `SET LOCAL app.current_org_id` dentro de uma transação por requisição,
`TenantContextInterceptor`/`AsyncLocalStorage`) teria que ser reimplementada do zero nesse novo serviço,
porque o Harvey é single-tenant por design — exatamente a classe de bug que o RLS existe para tornar
estruturalmente difícil, não apenas uma regra de lint. Também é operacionalmente mais caro: um segundo
deployável, banco, segredos e superfície de on-call, para um monorepo que deliberadamente mantém
api/web/worker fortemente acoplados via tipos Prisma e `@opsmind/shared-types` compartilhados.

**C — portar o código pontual que é reaproveitável, reconstruir nativamente o resto (recomendado).** A
licença MIT permite copiar e traduzir diretamente os trechos de lógica pura listados na seção 1 (a
fórmula de `fit.py`, a lista de `gate.py`, os regex de `profile.py`, as regras de `writer.md`) — isso não
é uma reinterpretação por cautela jurídica, é o próprio código, só traduzido de Python pra TypeScript
porque é a linguagem do resto do OpsMind, não porque copiar Python literalmente seria proibido. O que não
é reaproveitável nem como código nem como ideia-sem-adaptação é a camada de estado/execução (schema
SQLite, loop de orquestração single-tenant, runtime via assinatura pessoal) — ali o bloqueio é técnico
(sem `organizationId` em lugar nenhum) e legal (ToS de assinatura pessoal), não um princípio de "nunca
copiar código".

O OpsMind já tem o encaixe exato para essas ideias/código: uma camada de IA com tool-calling e
`AiToolContext` nunca controlável pelo modelo; uma máquina de estados de aprovação humana
(`OutreachService.applyTransition`, segura contra TOCTOU) que já impõe "IA só rascunha, humano envia";
uma função de scoring pura (`scoreLead` em `packages/shared-types/src/lead-scoring.ts`) que já é quase
idêntica à ideia #2 do Harvey; e uma regra de governança já registrada em
`docs/planning/sprint-1-2-plan.md` de que o módulo `ai` não pode se tornar um "god-module via fan-out" —
só a reconstrução nativa consegue respeitar essa regra, porque A e B exigem que o módulo `ai` (ou um
proxy do Harvey) alcance mais superfície, nunca menos.

Custo/complexidade/manutenção: mais um modelo Prisma + um tipo de job no worker + algumas tools de IA
novas, revisado pelo mesmo CI, implantado pelo mesmo `turbo build` — contra um runtime novo (A) ou um
serviço novo + camada de sincronização (B). Risco de dependência externa: C não adiciona nenhuma
dependência nova (continua `ANTHROPIC_API_KEY` por token, continua os 4 gateways existentes ou um
profiler HTTP simples sem dependência — ver seção 5); A e B importam uma dependência da
continuidade/compatibilidade de um projeto que foi apenas lido, não desenhado como upstream estável.

### 3.1 — O que é código portado diretamente, lado a lado

| Trecho do Harvey (fonte) | O que faz | Destino no OpsMind |
|---|---|---|
| `harvey/fit.py` — buckets de `company_fit()` | Fórmula de pontuação 0–100 por critério, com motivo legível por ponto | Novo bucket `signalFitPoints` em `packages/shared-types/src/lead-scoring.ts` (seção 4) |
| `harvey/gate.py` — tupla `BANNED_PHRASES` | Lista de frases proibidas checada em código, não só no prompt | `checkOutreachGate()` em `packages/shared-types/src/outreach-guardrails.ts` (seção 5) |
| `harvey/collectors/profile.py` — padrões regex sobre HTML já buscado | Detecção de HTTPS, formulário de contato, ano de copyright, links sociais, viewport mobile | `apps/worker/src/website-profiler-processor.ts` (seção 5) |
| `prompts/writer.md` + `skills/email_frameworks.md` — regras estruturais (gancho→dor→oferta→1 CTA, frases a evitar) | Estrutura do prompt de redação | Já parcialmente presente em `OUTREACH_SYSTEM_PROMPT_LINES` (`outreach.service.ts`); completar com as regras ainda faltantes do Harvey (ex.: limite de palavras por e-mail, "um parágrafo, uma pergunta") |

Cada arquivo que portar um trecho reconhecível do Harvey deve trazer um comentário curto citando a
origem (`// fórmula adaptada de harvey/fit.py (MIT, ethanplusai/harvey)`) — não é exigência legal estrita
para lógica/algoritmo (que não é protegido por copyright, só a expressão literal do código seria), mas é
boa prática de transparência e facilita auditoria futura de onde cada regra veio.

### 3.2 — Fluxo proposto (dentro do OpsMind, sem novo serviço/produto)

```
ServiceOffering (ICP)                                   AI tools (ai.module.ts)
      │                                                  ├─ investigate_company_website (fire-and-forget)
      ▼                                                  ├─ list_lead_signals (read-only)
ProspectingTarget ──► ScrapeJob ──► lead-scrape-processor ├─ map_signal_to_offering (determinístico)
 (recorrente)          (sob demanda)   (worker, 3 tx)      ├─ score_lead (existente, +signalFitPoints)
                              │                            ├─ generate_outreach_message (existente)
                              ▼                            └─ propose_signal_code (governança)
                            Lead ◄────────────────────────────────┐
                              │                                     │
                              ▼                                     │
                   website-profiler-processor (novo, 3 tx)          │
                   HTTP simples + regex no site do próprio lead     │
                   (sem Apify/Explorium/Camoufox — ver seção 5)     │
                              │                                     │
                              ▼                                     │
                         LeadSignal[] (observações, evidência, confiança)
                              │                                     │
                              ▼                                     │
                   scoreLead() [+signalFitPoints] ──────────────────┘
                              │
                              ▼
                   OutreachService.generateDraft() (cita LeadSignal.evidenceQuote)
                              │
                              ▼
                   checkOutreachGate() [NOVO portão determinístico]
                              │
                        DRAFT → aprovação humana obrigatória (já existe, inalterado)
                              │
                              ▼
                          APPROVED → send() → SENT → REPLIED
```

---

## 4. Modelo de dados

- **`LeadSignal`** (novo modelo) — a camada estruturada/filtrável que falta hoje. `LeadEnrichment`
  continua existindo sem mudança (blobs JSON inteiros de enriquecimento: resposta bruta do Explorium,
  resposta bruta de enriquecimento de contato) — não é um bom lugar para a ideia de observações porque
  não tem `signalCode`/`confidence`/`evidenceUrl` como colunas de primeira classe nem foi pensado para
  ser filtrado como coorte. Campos: `organizationId`, `leadId`, `signalCode` (FK governada), `value`,
  `confidence` (decimal 0–1, sempre atribuída por regra fixa do coletor, nunca um float livre gerado por
  IA — mantém o scoring 100% auditável), `evidenceUrl`, `evidenceQuote`, `collector`, `runId`,
  `observedAt`, `marketOpportunityId?` (join opcional para explicar que um sinal bate com um padrão de
  mercado já visto no Reddit). RLS idêntico a todo outro modelo (migração habilitando RLS + política,
  mesmo texto de `20260908120600_market_opportunities_rls`).
- **`SignalCode`** (novo modelo) — vocabulário governado: `code`, `organizationId?` (null = global
  semeado por migração; preenchido = proposto por uma organização), `label`, `category`,
  `defaultServiceOfferingId?`, `status` (`PROPOSED`/`CONFIRMED`/`DEPRECATED`).
  **Atualização pós-implementação**: a rejeição de `signal_code` não cadastrado acabou não precisando de
  trigger nenhum — `LeadSignal.signalCode` é uma **FK real** contra `SignalCode.code`
  (`onDelete: Restrict`), então a integridade referencial padrão do Postgres já rejeita o INSERT na hora,
  sem introduzir o primeiro trigger da história deste projeto (confirmado nesta sessão: 0 triggers em 33
  migrações antes desta). O que uma FK não cobre — rejeitar especificamente um código `DEPRECATED`, não
  só "não existe" — continua em código de aplicação, no único caminho de escrita
  (`website-profiler-processor.ts`/`SignalCodesService`). Tabela semeada (não enum Prisma, não texto
  livre sem governança) continua sendo a decisão certa pelos motivos já descritos abaixo.
- **Mapeamento de oportunidade**: reaproveita o `ServiceOffering` existente via
  `SignalCode.defaultServiceOfferingId` — zero mudança de schema nele. Para múltiplos sinais batendo, o
  ranking é calculado na leitura (mesma filosofia do scoring: nunca armazenado), agrupando `LeadSignal`
  por `signalCode`.
- **`ProspectingTarget`/`MarketOpportunity`/`RedditWatchTopic`**: `ProspectingTarget` não muda (é "onde
  procurar", ortogonal a "o que achamos"). `MarketOpportunity` não é fundido em `LeadSignal`
  (granularidade diferente — padrão de mercado vs. fato de uma empresa específica); ganha só o join
  opcional citado acima. **Correção importante de verificação direta nesta investigação**:
  `ProspectingTarget` e `MarketOpportunity` **já têm páginas e item de navegação**
  (`apps/web/lib/nav-items.ts`, páginas em `apps/web/app/.../prospecting-targets/` e
  `.../market-opportunities/`) — não são "backend-only" como uma leitura inicial do schema sugeriu. Só
  `RedditWatchTopic` genuinamente não tem UI/nav hoje — gap real, mas pequeno.
- **`scoreLead()`** (`packages/shared-types/src/lead-scoring.ts`) ganha um quinto bucket
  `signalFitPoints`, contando `LeadSignal` de vocabulário `CONFIRMED` cujo `SignalCode` aponta para uma
  `ServiceOffering` ativa — mesma disciplina de "retorna pontos + motivos legíveis, nunca IA" que a
  função já tem hoje; `LeadScoreBar` no frontend já itera as linhas do breakdown genericamente, então a
  UI ganha a nova linha de graça.

---

## 5. Novas AI tools e worker

Todas seguem o padrão existente (`apps/api/src/modules/ai/tools/*.tool.ts`, registradas em
`ai.module.ts`) e a regra já registrada em `sprint-1-2-plan.md`: toda tool chama um serviço público de
outro módulo, nunca um repositório/modelo Prisma direto.

| Tool | Tipo | Gate | Chama | Nunca pode |
|---|---|---|---|---|
| `investigate_company_website` | write (fire-and-forget) | `WRITE_ROLES` | novo `WebsiteProfilerService` | chamar gateway pago direto; aprovar/enviar |
| `list_lead_signals` | read-only | nenhum | `LeadSignalsService.listForLead()` | mutar dado |
| `map_signal_to_offering` | read-only, determinístico | nenhum | helper puro (como `scoreLead`) | chamar o modelo de IA |
| `score_lead` | write (existente) | `WRITE_ROLES` | `LeadsService.score()` ampliado | — |
| `generate_outreach_message` | write (existente, só o serviço ganha citações melhores) | `WRITE_ROLES` | `OutreachService.generateDraft()` | aprovar/enviar — regra dura no topo do arquivo já proíbe isso |
| `propose_signal_code` | write (cria `SignalCode` sempre `PROPOSED`, sempre com `organizationId`) | `WRITE_ROLES` | novo `SignalCodesService.propose()` | auto-confirmar; criar código global |

Nenhuma tool nova toca `OutreachMessage.status` — extensão direta da regra dura já existente em
`generate-outreach-message.tool.ts`.

**Novo portão determinístico anti-texto-genérico** (ideia do Harvey ainda ausente no OpsMind): função
pura `checkOutreachGate(body, subject)` em `packages/shared-types/src/outreach-guardrails.ts` (mesmo
padrão de `lead-scoring.ts` — sem framework, usada por `api` e `worker`), checando frases proibidas (já
instruídas no prompt, agora também aplicadas em código), tags de merge não substituídas, links fora do
domínio do lead, limite de palavras, rodapé de compliance ausente. Ligada em `OutreachService.approve()`
— bloqueia a aprovação com `BadRequestException` se falhar (mais estrito que o Harvey, que só reserva o
portão forte para o modo autopilot; o OpsMind não tem autopilot, então este é o único portão e deve
bloquear, não só avisar).

**Worker**: novo tipo de job `WEBSITE_PROFILE` na infraestrutura BullMQ já existente (não uma fila
nova), processado por `apps/worker/src/website-profiler-processor.ts`, reaproveitando o padrão de 3
transações curtas de `lead-scrape-processor.ts`. A fase sem transação faz **requisições HTTP simples +
regex no próprio site do lead** (homepage, `/contato`, `robots.txt`/`sitemap.xml`) — deliberadamente
**sem depender de Apify/Explorium/Camoufox**: esta investigação confirmou que 3 dos 4 gateways
existentes (`apify-gateway.ts`, `explorium-gateway.ts`, `contact-enrichment-gateway.ts`) estão
explicitamente marcados no próprio código como "ASSUMED, not verified live" — apostar a capacidade
inteira de investigação de site nessas integrações não verificadas seria arriscado; um profiler via HTTP
direto no site já conhecido do lead tem custo marginal ~$0 e zero dependência externa nova, exatamente
copiando o próprio profiler do Harvey (3 requisições HTTP + regex, sem navegador, sem API paga).

---

## 6. Integração com o frontend (sem segundo dashboard)

Fica dentro do grupo de navegação `workspace` já existente (`apps/web/lib/nav-items.ts`), nunca em uma
nova seção de topo "Inteligência Comercial" nem no grupo `intelligence` (esse grupo já é especificamente
o assistente de chat IA + páginas de uso/orçamento — uma preocupação diferente de "gerenciar meu
pipeline"). Isso segue a instrução explícita do usuário e o precedente já estabelecido por
`ProspectingTarget`/`MarketOpportunity`, que já vivem em `workspace` ao lado de Leads/Aprovações.

- Estende a página de detalhe do lead com uma seção "Sinais detectados" (`LeadSignal` agrupados por
  categoria, com evidência/confiança) — componente novo `lead-signals-panel.tsx`, mesma linguagem visual
  do breakdown clicável de `LeadScoreBar`.
- Estende `LeadScoreBar` com a nova linha `signalFitPoints` (extensão de um array já genérico).
- Botão "Investigar site" na página de detalhe, chamando o novo endpoint/tool, com o mesmo padrão de
  polling assíncrono já usado por `find_leads`.
- Item de navegação novo só para o gap real: "Monitoramento de tópicos" (`RedditWatchTopic`), reusando o
  hook `use-reddit-watch-topics.ts` que já existe sem página.
- Página de aprovações (`.../outreach`) ganha um selo de aviso quando `checkOutreachGate` falhar.

---

## 7. Segurança e conformidade — o que já existe vs. o que é novo

| Salvaguarda do Harvey | Status no OpsMind | Mecanismo |
|---|---|---|
| Opt-out/ameaça legal detectado antes de qualquer classificação por IA | Parcial | `Lead.unsubscribedAt` já checado antes de enviar; não há classificação automática de resposta ainda (hoje é humano via inbox compartilhada) — só seria "novo" se essa automação for criada no futuro |
| Parar contato com toda a empresa ao receber 1 resposta | Novo | Hoje só aquela `OutreachMessage`/`Lead` muda para `REPLIED`; precisaria de uma chave de domínio da empresa + checagem em `send()` |
| Kill switch por taxa de bounce | Já existe, mais amplo que o Harvey | `EmailWarmupService.checkCanSend()` dentro de `send()` |
| Cerca contra prompt injection em texto externo | Já existe | `OUTREACH_SYSTEM_PROMPT_LINES` em `outreach.service.ts` já trata dado do lead como dado, nunca instrução — a extensão para `LeadSignal.evidenceQuote` deve reusar a mesma linha |
| Portão determinístico antes do envio (frases proibidas, links, rodapé) | Novo | `checkOutreachGate()` — seção 5 |
| Lista de não contatar | Já existe | `Lead.unsubscribedAt`, aplicado em `send()` |
| Proteção contra envio duplicado | Já existe | `idempotencyKey` no Resend + `applyTransition` seguro contra TOCTOU |
| Aprovação humana obrigatória por padrão | Já existe, mais estrito que o Harvey | `DRAFT→APPROVED→SENT` via `applyTransition`; comentário "REGRA DURA" no topo de `generate-outreach-message.tool.ts` proíbe qualquer tool de IA alcançar aprovação/envio |

---

## 8. Roadmap em fases

0. **Fundação de dados** (sem UI): `LeadSignal`, `SignalCode` + seed + trigger, RLS, extensão de
   `scoreLead()` com `signalFitPoints` (zero por padrão até a Fase 1 popular — compatível com scores
   existentes).
1. **Profiler sem IA**: `website-profiler-processor.ts` (HTTP+regex), endpoint manual atrás de
   `WRITE_ROLES`, sem tool de IA ainda. Entrega valor real imediato (sinais reais, score real) sem custo
   de IA.
2. **UI**: painel "Sinais detectados" + extensão do `LeadScoreBar` + botão manual "Investigar site" —
   primeiro marco visível da nova capacidade.
3. **Tools de IA + portão de segurança**: `investigate_company_website`, `list_lead_signals`,
   `map_signal_to_offering`, e **`checkOutreachGate()` ligado em `approve()` como bloqueio duro** — o
   controle de segurança entra antes de qualquer automação mais arriscada.
4. **Outreach mais rico**: citar `LeadSignal.evidenceQuote`/`evidenceUrl` no rascunho em vez de só
   `matchedSignals`.
5. **Governança de vocabulário**: tool `propose_signal_code` + tela pequena de revisão admin
   (`PROPOSED→CONFIRMED`), fechando o ciclo de vida sem precisar de migração por novo tipo de sinal.
6. **Fechar lacunas existentes**: UI de `RedditWatchTopic` + join `MarketOpportunity`↔`LeadSignal` —
   menor risco, maior "terminar o que já foi construído".
7. **(Opcional, deliberadamente por último) Gatilho automático**: investigar site automaticamente ao
   lead ficar `QUALIFIED`, espelhando o gatilho de autodraft já existente — só depois que as fases 1–4
   validarem qualidade/custo em produção, porque é o passo que mais aumenta o raio de impacto.

---

## 9. Análise de custos

Custo marginal da nova capacidade, isolado do que já existe hoje (descoberta/outreach já cobrados pelo
orçamento mensal por organização, `Organization.aiMonthlyBudget`, já em produção):

- **Investigação de site** (Fases 0–2): ~$0 marginal — requisições HTTP ao próprio site do lead, sem API
  paga. Custo real é só CPU/tempo do worker, desprezível. Não precisa de limite de orçamento em $, só um
  limite de taxa por organização (para não deixar alguém disparar "investigar 500 leads de uma vez" sem
  controle de fila).
- **IA (Fase 3 em diante)**: usando a tabela de preço já em produção (`claude-opus-5`, $5/$25 por milhão
  de tokens entrada/saída):
  - `analyze_lead_potential` por lead: ordem de grandeza de $0,01–0,02/lead.
  - `generate_outreach_message` (com citações de sinais, prompt um pouco maior): ordem de grandeza de
    $0,02–0,04/lead.
  - Um piloto pequeno (1 organização, ~500 leads descobertos/mês, investigação em ~300 com site, análise
    de IA + rascunho nos ~100 melhor qualificados) fica em torno de **$5–10/mês em IA** — adicional
    pequeno sobre o que a organização já gasta hoje em `find_leads`/`analyze_lead_potential` existentes.
  - Em escala (dezenas de organizações no mesmo volume): algumas centenas de dólares/mês platform-wide —
    segue o mesmo modelo de cobrança por token que o OpsMind já usa, sem custo fixo novo de
    infraestrutura de IA.
- **Descoberta** (já existente, não é custo novo desta feature): Apify Google Maps ~$0,006/lead,
  Explorium ~$0,05/resultado, Camoufox ~$0,001/resultado (custo próprio de hospedagem, já incorrido).
- **Risco de custo a monitorar, não estimável com confiança hoje**: o contrato real de preço do
  Explorium **não foi verificado nesta investigação** (o gateway inteiro está marcado como "não
  verificado ao vivo" no próprio código) — antes de qualquer piloto que dependa de volume alto de
  firmographics via Explorium, validar o contrato de API e preço real com a conta, não só a documentação
  pública.
- **Sem custo fixo novo de infraestrutura**: reaproveita Postgres/Redis/BullMQ já em produção; não
  precisa de um novo serviço, banco, ou fila dedicada.

---

## 10. O que não foi possível verificar / lacunas encontradas

- Um documento de plano chamado `pensando-como-empresa-com-agile-beaver.md`, citado por nome em mais de
  15 comentários de migração/código como origem de boa parte do escopo recente (Negócios/Deals,
  Reuniões, Financeiro, assinatura de documentos, roteamento de leads, inbox compartilhada, mineração de
  sinais do Reddit), **não existe em nenhum lugar do repositório nem do diretório home** — confirmado por
  busca direta. Vale levantar com quem escreveu esses comentários antes de assumir o racional completo
  por trás dessas decisões.
- Existe um git worktree irmão, ativo, em `.worktrees/feat-prospecting-outbound/` (branch
  `feat/prospecting-outbound`), de onde a máquina de estados de outreach atual foi "adaptada quase
  verbatim" segundo um comentário de migração — inspecionável diretamente se quiser comparar com mais
  profundidade.
- O contrato real da API da Explorium e dois dos atores de enriquecimento de contato da Apify nunca
  foram verificados contra uma conta real — ver seção 9.

---

## Arquivos críticos referenciados (nenhum foi modificado para produzir este diagnóstico)

- `packages/database/prisma/schema.prisma` — onde `LeadSignal`/`SignalCode` entrariam
- `packages/shared-types/src/lead-scoring.ts` — onde `signalFitPoints` entraria
- `apps/api/src/modules/leads/outreach.service.ts` — onde `checkOutreachGate()` entraria
- `apps/api/src/modules/ai/tools/generate-outreach-message.tool.ts` — padrão/regra dura a preservar
- `apps/worker/src/lead-scrape-processor.ts` — padrão de referência para o novo profiler
- `apps/web/lib/nav-items.ts`, `apps/web/components/leads/lead-score-bar.tsx` — pontos de extensão no frontend
