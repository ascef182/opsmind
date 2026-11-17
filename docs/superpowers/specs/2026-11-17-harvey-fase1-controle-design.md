# Harvey — Fase 1: Controle do agente (design)

> Status: rascunho para revisão (2026-11-17). Nenhum código alterado.
> Contexto: pedido "Revenue Engine 2.0 — Harvey como SDR autônomo da CazaTech", fases 1–5 definidas pela
> responsável. Este documento cobre só a Fase 1. Roadmap anterior (ainda válido nas partes não substituídas):
> `docs/superpowers/plans/2026-11-17-revenue-engine-roadmap.md`.

## 0. Ajustes da revisão (2026-11-17) — prevalecem sobre o resto do documento

1. **O controle do agente não restringe o operador humano.** Com o Harvey `PAUSED`/`STOPPED`, só o trabalho
   automático para. Envio clicado por um humano, rascunho e análise pedidos manualmente, edição de leads e
   (Fase 4) assumir conversas continuam funcionando. A verificação final da §6.6 vale só para envios iniciados
   pelo Harvey (`initiator: HARVEY`); na Fase 1 ainda não há envio automático, então ela existe e é testada, mas
   todo envio real atual é humano e não passa por ela. Substitui a decisão 10.1.
2. **Pedido manual é independente.** Análise de site e rascunho pedidos explicitamente por uma pessoa (tela ou
   chat) levam `trigger: 'MANUAL'` no job e nunca passam pelo ponto de verificação. Só jobs disparados
   automaticamente (`trigger: 'AUTOMATIC'`: busca do Harvey, cascata de qualificação) dependem do estado do
   agente. A decisão 10.8 continua valendo só para a cascata automática.
3. **Envio com resultado desconhecido.** `OutreachStatus` ganha `SENDING` e `SEND_UNKNOWN`:
   - A reivindicação (`APPROVED → SENDING`) é gravada numa transação própria, confirmada antes da chamada ao
     provedor, junto com o payload exato do envio (`sendRequest`). O registro de sucesso (`SENT` +
     `providerMessageId`) também é confirmado numa transação própria logo após o provedor responder.
   - Um `SENDING` com mais de 10 min vira `SEND_UNKNOWN` (tick do worker), com atividade
     `outreach.send_uncertain` e um job de reconciliação.
   - Reconciliação (consumer na API, onde está o cliente do provedor): reenvia **o mesmo payload com a mesma
     chave de idempotência** dentro de 23h da reivindicação. O Resend devolve a resposta original sem enviar de
     novo se já tinha recebido (confirmação → `SENT`); se não tinha recebido, o envio autorizado acontece agora
     uma única vez (→ `SENT`). Antes de reenviar, as travas que valiam no clique são rechecadas (pausa global,
     liberação da organização, opt-out; e o estado do agente se o envio era do Harvey). Trava recusando, chave
     expirada (> 23h) ou resposta de conflito de idempotência → continua `SEND_UNKNOWN` e OWNER/ADMIN são
     notificados.
   - Resolução humana: `POST …/outreach-messages/:id/resolve-unknown` com `outcome: 'SENT' | 'NOT_SENT'`
     (`NOT_SENT` volta a `APPROVED`). Nunca reenvio fora da janela de idempotência.

## 1. Intenção

Hoje "Harvey" não é um agente em execução: é o nome do projeto open source (`ethanplusai/harvey`) do qual o
OpsMind adaptou extratores de sinais, guardrails de copy e o gatilho de qualificação. O que existe é uma cadeia
de jobs independentes (scan de prospecção → `lead-scrape` → `website-profile` → `scoreLead()` →
`outreach-autodraft` → aprovação humana → envio por e-mail), sem estado de execução, sem comando de
iniciar/pausar/parar, sem metas, sem horário, sem timeline e sem tempo real. A pausa existente
(`outreachPaused`) só bloqueia o envio — prospecção e rascunhos continuam rodando.

A Fase 1 transforma essa cadeia em **um agente que a responsável consegue iniciar, acompanhar, interromper e
retomar com segurança**, e que mostra o que está fazendo agora, não só o resultado. É a fundação das fases
seguintes (inteligência comercial, comunicação, supervisão humana, inteligência de resultados).

## 2. Objetivos, não-objetivos e anti-objetivos

**Objetivos**
- Comandos reais de Iniciar, Pausar, Retomar e Parar, processados e respeitados pelo backend em todas as etapas.
- Estado do agente derivado do que está de fato rodando (nunca um rótulo visual independente).
- Timeline persistente de atividades com início, fim, resultado, lead relacionado e justificativa, em tempo real.
- Metas diárias e horários de trabalho configuráveis.
- Configuração por campanha (país, idioma, fuso, horários, metas, canais, orçamento), com uma campanha padrão
  criada para cada organização.
- Nenhuma execução duplicada entre réplicas do worker e nenhum envio duplicado em reinícios/falhas.
- Recuperação após reinício sem perder histórico.

**Não-objetivos (fases seguintes)**
- Catálogo consultivo, dores, múltiplas oportunidades por lead, memória comercial por lead (Fase 2).
- WhatsApp, central de conversas, interpretação de respostas, envio autônomo (Fase 3).
- Assumir conversa, instruções contextuais (Fase 4).
- Relatórios de conversão por produto/segmento (Fase 5).
- CRUD completo de campanhas com escopo de produtos e regras de abordagem (a tabela nasce agora; a tela de
  criação fica mínima).

**Anti-objetivos (falha mesmo se "funcionar")**
- Um loop de LLM contínuo coordenando o trabalho (custo e imprevisibilidade).
- Estado ou atividade exibidos sem corresponder a um processo real.
- Qualquer mensagem saindo depois de uma pausa ou parada.
- Uma pausa que só muda a interface.
- Um design que prenda o engine a e-mail ou aos EUA.

## 3. Restrições

- Stack atual: NestJS (api), BullMQ + Redis, Prisma + Postgres com RLS, Next.js 14 (web). Sem dependências novas
  de infraestrutura.
- `apps/api` e `apps/worker` não importam um do outro; lógica compartilhada vai para `packages/shared-types`
  (pura) ou `packages/database` (recebe client/transação Prisma).
- Toda tabela nova com `organization_id` e política RLS no padrão existente (migration de tabela + migration
  `*_rls` separada).
- Orçamento do engine (~US$50/mês) não muda: a Fase 1 não adiciona chamadas de IA.
- Toda escrita de `Lead.status`/`Deal.stage` continua gravando `PipelineStageTransition`.
- Aprovação de outreach continua sempre humana; nenhuma AI tool nova.

## 4. Abordagens consideradas

| Abordagem | Como | Por que não / por que sim |
|---|---|---|
| A. Loop de LLM ("agente pensante") | Um modelo decide a próxima ação em ciclo | Estoura o orçamento, difícil de pausar com garantia, difícil de auditar. Descartada. |
| B. Painel sobre logs existentes | Ler `AuditLog`/`ScrapeJob`/`OutreachMessage` e exibir | Não dá controle real: a pausa não seria respeitada. Descartada. |
| **C. Orquestrador determinístico (escolhida)** | Um "tick" periódico no worker, único entre réplicas, que reconcilia o estado do banco e enfileira os jobs que já existem; cada job checa o estado do agente antes de agir; atividades persistidas e publicadas | Reaproveita tudo o que funciona, custo zero de IA, pausa garantida por checagens no backend, retomada natural porque o trabalho pendente é sempre redescoberto a partir do banco. Aprovada pela responsável. |

## 5. Decisões da responsável (como decididas)

1. Harvey é um orquestrador determinístico que coordena os jobs existentes; nada é substituído.
2. A pausa bloqueia novas atividades em todas as etapas. Para comunicação externa, há uma última verificação
   do estado do agente imediatamente antes do envio. Idempotência impede envio duplicado em reinício/falha.
3. A timeline mostra o trabalho em andamento (pesquisando, analisando site, identificando gargalos, comparando
   com produtos, qualificando, preparando abordagem), cada atividade com início, conclusão, resultado e lead.
4. Configuração por campanha (país, região, idioma, segmento, produtos, canais, horários, orçamento); não é
   preciso implementar todas as campanhas agora, mas a arquitetura não pode impedir.
5. Estados distintos: PAUSADO preserva o contexto e retoma; PARADO encerra o ciclo e não reinicia sozinho no dia
   seguinte; CONCLUÍDO encerra o ciclo por meta ou horário e o próximo dia começa sozinho se o agente estiver
   ativo.
6. A Fase 1 não pode dificultar: memória comercial por lead, catálogo inteligente, múltiplas oportunidades por
   empresa, central de conversas com transferência de atendimento, múltiplos canais.
7. A deduplicação entre réplicas do worker precisa estar resolvida nesta fase.
8. Sucesso do Harvey é medido por oportunidades geradas (quantidade e qualidade), não por mensagens enviadas.

## 6. Design

### 6.1 Modelo de dados (migrations `20261118120000_harvey_control` + `20261118120100_harvey_control_rls`)

**`SalesCampaign`** — configuração independente por campanha.

| Campo | Tipo | Nota |
|---|---|---|
| `id`, `organizationId` | uuid | RLS |
| `name` | text | único por organização |
| `status` | `CampaignStatus` (`ACTIVE`, `ARCHIVED`) | só `ACTIVE` recebe trabalho |
| `country` | text (ISO-3166 alpha-2) | |
| `regionLabel` | text? | texto livre ("Texas", "Grande SP") — a região efetiva vem dos alvos |
| `language` | text (BCP-47, ex.: `pt-BR`, `en-US`) | lido pelas fases 2–3 para o idioma da abordagem |
| `timezone` | text (IANA) | base do "dia" e dos horários |
| `workingDays` | int[] (1=seg … 7=dom) | default seg–sex |
| `workStartMinute`, `workEndMinute` | int (minutos desde 00:00) | default 540–1080 (09:00–18:00); fim > início |
| `dailyResearchGoal` | int | leads novos pesquisados/dia (default 30) |
| `dailyQualifiedGoal` | int | leads qualificados/dia (default 15) |
| `dailyOutreachGoal` | int | abordagens preparadas/dia (default 10) |
| `enabledChannels` | `OutreachChannel[]` | default `{EMAIL}` |
| `monthlyBudgetUsd` | decimal? | null = usa o teto do engine da organização |
| `requireFirstContactApproval` | bool default true | reservado: na Fase 1 toda aprovação já é humana |
| `createdAt`, `updatedAt` | | |

Segmentos e região de busca continuam em `ProspectingTarget`, que ganha `campaignId` (NOT NULL após backfill).
Produtos por campanha e regras de abordagem entram na Fase 2 como colunas/tabelas novas ligadas a
`SalesCampaign`.

Backfill: uma campanha "Campanha padrão" por organização existente, com `country` = `defaultOutreachCountry`,
`language`/`timezone` derivados (`US` → `en-US`/`America/New_York`; `BR` → `pt-BR`/`America/Sao_Paulo`;
outros → `en-US`/`UTC`), `dailyResearchGoal` = `dailyResearchLimit` atual. Todos os `ProspectingTarget` da
organização passam a apontar para ela, assim como os leads existentes vindos de busca (`sourceType <> 'MANUAL'`),
para que o tick encontre o trabalho pendente deles. Toda organização recebe uma linha `HarveyAgent` `STOPPED`.
Organizações novas recebem a campanha padrão e o agente na criação.

**`HarveyAgent`** — 1:1 com `Organization`. O comando da responsável, persistido.

| Campo | Tipo | Nota |
|---|---|---|
| `organizationId` | uuid PK | |
| `controlState` | `HarveyControlState` (`STOPPED`, `ACTIVE`, `PAUSED`) | default `STOPPED` |
| `controlChangedAt`, `controlChangedByUserId` | | |
| `version` | int | concorrência otimista dos comandos |

**`HarveyRun`** — um ciclo de trabalho de um dia de uma campanha.

| Campo | Tipo | Nota |
|---|---|---|
| `id`, `organizationId`, `campaignId` | | |
| `cycleDate` | date | data local no fuso da campanha; **único (`campaignId`, `cycleDate`)** |
| `status` | `HarveyRunStatus` (`RUNNING`, `PAUSED`, `STOPPED`, `COMPLETED`) | |
| `endReason` | text? | `GOALS_MET`, `HOURS_ENDED`, `STOPPED_BY_USER`, `NO_WORK_AVAILABLE`, `BUDGET_EXCEEDED`, `DAY_ENDED_WHILE_PAUSED` |
| `goals` | jsonb | cópia das metas no início do ciclo (mudanças no meio do dia valem a partir do próximo tick e atualizam esta cópia) |
| `startedAt`, `endedAt` | | |
| `pausedAt` | timestamptz? | início da pausa atual |
| `pausedMs` | bigint | tempo pausado acumulado, para "tempo em execução" |
| `lastErrorAt`, `lastErrorMessage`, `lastSuccessAt` | | base do estado ERROR |

**`HarveyActivity`** — registro persistente de tudo que o Harvey faz (append + transição de status).

| Campo | Tipo | Nota |
|---|---|---|
| `id`, `organizationId` | | |
| `campaignId`, `runId` | uuid? | |
| `type` | text | catálogo fechado em `packages/shared-types` (6.4) |
| `phase` | `HarveyPhase` (`RESEARCHING`, `QUALIFYING`, `PREPARING_OUTREACH`, `SENDING`, `RESPONDING`, `CONTROL`) | |
| `title` | text | frase pt-BR pronta para exibir |
| `status` | `HarveyActivityStatus` (`STARTED`, `SUCCEEDED`, `FAILED`, `SKIPPED`, `CANCELLED`) | eventos instantâneos já nascem finalizados |
| `startedAt`, `finishedAt` | | |
| `leadId`, `scrapeJobId`, `outreachMessageId` | uuid? (FK `SET NULL`) | link para o lead/mensagem |
| `channel` | `OutreachChannel`? | atividades de comunicação |
| `result` | jsonb? | números e resumo do resultado |
| `rationale` | jsonb? | `{ summary, reasons: string[], evidence: [{ quote, url }] }` — justificativa comercial objetiva, nunca raciocínio interno do modelo |
| `errorMessage` | text? | |
| `queueJobId` | text? | job BullMQ dono da atividade (recuperação após reinício) |
| `idempotencyKey` | text | **único (`organizationId`, `idempotencyKey`)**: uma nova tentativa do mesmo job reaproveita a linha |
| `actorType`, `actorId` | | `SYSTEM` para o Harvey, `USER` para comandos |

Índices: (`organizationId`, `startedAt` desc), (`organizationId`, `leadId`), (`runId`, `type`, `status`),
parcial (`organizationId`) `WHERE status = 'STARTED'`.

**Colunas novas em tabelas existentes**
- `ProspectingTarget.campaignId`.
- `ScrapeJob.campaignId?`, `ScrapeJob.prospectingTargetId?`, `ScrapeJob.harveyRunId?`; índice único parcial
  (`harveyRunId`, `prospectingTargetId`) onde ambos não são nulos — o banco impede duas buscas do mesmo alvo no
  mesmo ciclo, mesmo com duas réplicas.
- `Lead.campaignId?` — campanha de origem (preenchido pelo processor via `ScrapeJob.campaignId`).
- `OutreachStatus` ganha `SENDING`; `OutreachMessage.sendClaimedAt?` (6.6).

`OrganizationRevenueSettings.outreachPaused` continua existindo com outro papel: é a **liberação de envio da
organização** (domínio, compliance), independente do agente. Para uma mensagem sair, ambos precisam permitir.
`dailyResearchLimit` deixa de ser usado (substituído pela meta da campanha); a coluna fica até uma limpeza
futura.

### 6.2 Comandos

`POST organizations/:id/revenue/harvey/commands` com `{ command: 'START' | 'PAUSE' | 'RESUME' | 'STOP', reason? }`,
restrito a OWNER/ADMIN, auditado (`harvey.command.*`), gera uma atividade `control.command` e publica evento.

| Comando | De | Para | Efeito nos ciclos de hoje |
|---|---|---|---|
| Iniciar | `STOPPED` | `ACTIVE` | o próximo tick (≤ 1 min; o comando também enfileira um tick imediato) abre ciclos nas campanhas dentro do horário |
| Pausar | `ACTIVE` | `PAUSED` | ciclos `RUNNING` → `PAUSED` (`pausedAt`); nada novo começa; atividades em curso terminam o passo atual |
| Retomar | `PAUSED` | `ACTIVE` | ciclos `PAUSED` do dia → `RUNNING` (`pausedMs += agora − pausedAt`); o tick redescobre o trabalho pendente |
| Parar | `ACTIVE`/`PAUSED` | `STOPPED` | ciclos abertos → `STOPPED` (`STOPPED_BY_USER`); não reabre no dia seguinte |

Transição atômica: `UPDATE harvey_agents SET … WHERE organization_id = $1 AND control_state IN (…)`; zero
linhas → 409 com o estado atual. Comando inválido para o estado (ex.: Retomar estando parado) também é 409.

"Concluído" não é comando: é o fim natural de um ciclo (6.5). Com o agente `ACTIVE`, o próximo dia abre um ciclo
novo sozinho. Ciclo pausado que atravessa a meia-noite (fuso da campanha) é encerrado como
`DAY_ENDED_WHILE_PAUSED`; ao retomar, abre-se o ciclo do novo dia. O contexto não se perde porque o trabalho
pendente vive no banco (leads, sinais, rascunhos), não no ciclo.

### 6.3 Orquestrador (worker)

Fila nova `harvey-orchestrator` com um **job scheduler do BullMQ** (`upsertJobScheduler('harvey-tick',
{ every: 60_000 })`). O BullMQ garante uma única instância de cada repetição processada por um único worker,
qualquer que seja o número de réplicas. Defesa extra: dentro do tick, cada organização é processada sob
`pg_try_advisory_xact_lock(hashtext('harvey:' || org_id))`; se outra réplica já estiver nela, pula.

Cada tick, para cada organização com `HarveyAgent` `ACTIVE` ou com ciclo aberto, e cada campanha `ACTIVE`:
1. **Ciclo**: dentro do horário e sem ciclo hoje → `INSERT … ON CONFLICT DO NOTHING` (idempotente) +
   atividade `run.started`. Fora do horário com ciclo `RUNNING` → `COMPLETED`/`HOURS_ENDED`.
2. **Recuperação**: atividades `STARTED` cujo `queueJobId` não está mais ativo/esperando no BullMQ, ou sem job e
   com mais de 15 min → `FAILED` "interrompida (reinício do worker)". Mensagens `SENDING` há mais de 10 min →
   atividade `outreach.send_uncertain` + notificação para OWNER/ADMIN; **nunca reenvio automático**.
3. **Pesquisa**: se `researched < dailyResearchGoal` e `qualified < dailyQualifiedGoal`, nenhuma busca do ciclo
   em andamento, orçamento ok → escolhe o próximo `ProspectingTarget` ativo da campanha (rodízio, respeitando
   `cooldownDays`), cria o `ScrapeJob` com `limit = min(target.limit, metaRestante)` (o índice único impede
   duplicata) e enfileira `lead-scrape` com `jobId` determinístico `scrape:<scrapeJobId>`.
4. **Trabalho pendente** (é isto que faz o Retomar continuar de onde parou): leads da campanha `QUALIFIED` sem
   análise de site → `website-profile`; `QUALIFIED` com oferta sugerida e sem rascunho, até a meta de abordagens
   restante → `outreach-autodraft`. Ambos com `deduplication: { id: '<fila>:<leadId>' }` do BullMQ (não duplica
   enquanto houver job esperando/ativo).
5. **Conclusão**: sem atividade em curso e (metas de qualificação e abordagem batidas, ou meta de pesquisa
   esgotada sem trabalho pendente, ou nenhum alvo disponível) → `COMPLETED` com o motivo.
6. Publica `status.changed` quando o estado derivado (6.5) muda.

O `setInterval` do scan de prospecção (`scanProspectingTargets`) e o do scan de follow-up são removidos: o
primeiro vira o passo 3; o segundo passa a ser um scheduler BullMQ próprio (`outreach-followup`). Os demais
`setInterval` do worker (automações, lembretes, Reddit, alertas de gasto) não pertencem ao Harvey e ficam como
estão nesta fase — o problema de réplicas neles é registrado como pendência separada.

### 6.4 Pontos de verificação e atividades por etapa

Função compartilhada em `packages/database`: `checkHarveyMayProceed(tx, { organizationId, campaignId, step })`
→ `{ ok: true, runId } | { ok: false, reason }`. Recusa quando o agente não está `ACTIVE`, o ciclo não está
`RUNNING`, está fora do horário, a meta da etapa foi atingida ou o orçamento estourou. Só se aplica a trabalho
**iniciado pelo Harvey** (`actorType: SYSTEM`); ações manuais de um humano (pontuar, analisar, gerar rascunho
pela tela ou pelo chat) não são do Harvey e não passam por ela. Já os desdobramentos automáticos que hoje
nascem de uma ação humana (análise de site e rascunho automático disparados ao qualificar um lead pela tela, ou
a partir de uma busca criada manualmente) são trabalho do Harvey e passam pela verificação: com o agente parado,
eles não acontecem. É uma mudança de comportamento em relação a hoje.

| Etapa | Onde checa | Atividade (título exemplo) | Resultado / justificativa |
|---|---|---|---|
| Pesquisa | tick (passo 3) e início de `processLeadScrapeJob` | `research.search` "Pesquisando dentistas em Austin, TX" | encontrados, novos, duplicados ignorados, custo |
| Lead encontrado | ao criar lead novo | `research.lead_found` "Encontrou Smile Dental (novo lead)" | origem, campanha, data |
| Análise de site | início de `processWebsiteProfileJob` | `research.site_analysis` "Analisando o site de Smile Dental" | sinais confirmados com citação e URL = gargalos identificados |
| Qualificação | após `scoreLead()` | `qualification.score` "Smile Dental qualificado (72 pts)" | `reasons` do `scoreBreakdown` |
| Comparação com produtos | após qualificar | `qualification.offering_match` "Comparando com os produtos CazaTech → Website" | oferta sugerida e motivos da estratégia (`selectOutreachStrategy`) |
| Abordagem | início do `OutreachAutodraftConsumer` | `outreach.draft` "Preparando abordagem para Smile Dental" | estratégia, versões geradas, nota de qualidade ou motivo de descarte |
| Aguardando aprovação | rascunho salvo | `outreach.awaiting_approval` | link para a mensagem |
| Envio | `OutreachDispatchService` (6.6) | `outreach.sent` / `outreach.send_blocked` | canal, motivo do bloqueio |
| Resposta | webhook do Resend | `outreach.reply_received` | |
| Controle | comandos e tick | `control.command`, `run.started`, `run.completed` … | |

Job recusado no ponto de verificação termina com a atividade `SKIPPED` e motivo ("Harvey pausado"); o job não é
reprocessado — o passo 4 do tick o redescobre quando o agente voltar a `ACTIVE`. Busca externa já em andamento
quando a pausa chega termina e grava os leads (o custo já foi pago), mas não enfileira nada novo.

Interpretação honesta da Fase 1: "identificando gargalos" = sinais do profiler de site; "comparando com
produtos" = a regra de oferta/estratégia atual (palavra-chave + `ServiceOffering.kind`). A análise consultiva de
verdade é a Fase 2 e entra como novos tipos de atividade, sem mudar a tabela.

### 6.5 Estado exibido (derivado, nunca armazenado à parte)

Função pura `resolveHarveyStatus` em `packages/shared-types`, a partir de `controlState`, ciclos de hoje,
atividades `STARTED` e contagem de rascunhos pendentes:

1. `controlState = STOPPED` → **STOPPED** (ou **IDLE** se nunca foi iniciado).
2. `controlState = PAUSED` → **PAUSED**.
3. Algum ciclo com `lastErrorAt > lastSuccessAt` e nada rodando → **ERROR** (com a mensagem).
4. Há atividades `STARTED` → a fase de maior precedência entre elas: `SENDING` > `RESPONDING` >
   `PREPARING_OUTREACH` > `QUALIFYING` > `RESEARCHING`. A lista completa vai junto ("fazendo agora").
5. Ciclo `RUNNING` sem nada em curso: rascunhos aguardando aprovação e nenhum trabalho automático restante →
   **AWAITING_APPROVAL**; senão **RUNNING**.
6. Todos os ciclos de hoje `COMPLETED` → **COMPLETED**; agente ativo sem ciclo (fora do horário) → **IDLE** com o
   próximo horário de início.

`SENDING` e `RESPONDING` aparecem na Fase 1 só quando um envio aprovado sai ou uma resposta chega por webhook;
ficam frequentes na Fase 3.

### 6.6 Envio: verificação final e idempotência

`OutreachService.send()` passa a delegar para um `OutreachDispatchService` neutro de canal, com um registro
`ChannelSender` por canal (`EMAIL` → Resend; os demais não registrados = "canal não conectado"). Sequência:

1. Reivindica: `UPDATE outreach_messages SET status='SENDING', send_claimed_at=now() WHERE id=$1 AND
   status='APPROVED'`. Zero linhas → 409 (já enviada ou em envio). Dois cliques ou duas réplicas nunca passam
   daqui juntos.
2. Checagens existentes (pausa global, liberação da organização, teto diário, opt-out, endereço físico, warmup).
3. **Verificação final do agente**, lida do banco imediatamente antes da chamada ao provedor: Harvey
   `PAUSED`/`STOPPED` → volta a `APPROVED`, atividade `outreach.send_blocked`, 403.
4. Chamada ao provedor com `idempotencyKey = outreach-message/<id>` (já existe; o Resend deduplica por 24h).
5. Sucesso → `SENT`. Falha conhecida do provedor → volta a `APPROVED` com o erro. Queda do processo → fica
   `SENDING` e o passo 2 do tick sinaliza para verificação humana.

**Minha decisão a confirmar**: com o Harvey pausado ou parado, nenhum envio sai do engine, inclusive o envio
clicado manualmente por um humano. É a leitura mais segura de "o e-mail não pode sair depois da pausa".
Consequência: como o Harvey começa `STOPPED`, enviar exige iniciar o agente (o envio já está bloqueado hoje pela
liberação da organização e pela falta de domínio). "Marcar como enviada" (registro manual) continua livre.

### 6.7 Tempo real

- Publicação: depois do commit, quem grava a atividade publica o DTO serializado no canal Redis
  `harvey:org:<organizationId>` (worker via `ioredis` já existente; api via provider `HarveyEventsPublisher`).
- Entrega: `GET organizations/:id/revenue/harvey/stream`, Server-Sent Events com o `@Sse` do NestJS. Guards normais
  (JWT + `TenantGuard`) validam antes de abrir. Nova anotação `@SkipTenantTransaction()` faz o
  `TenantContextInterceptor` não abrir transação nessa rota — sem ela, a transação de 10s mataria o stream.
  Uma conexão Redis de assinatura por instância da API (`psubscribe harvey:org:*`), repassando para os streams
  da organização certa. Comentário de keep-alive a cada 25s.
- Persistência e reconexão: o pub/sub não é durável, então o banco é a fonte. Cada evento carrega o `id` e o
  `startedAt` da atividade; ao reconectar, o cliente pede `GET …/harvey/activities?after=<cursor>` e mescla.
  Nada se perde em reinício da API ou do worker.
- Web: `EventSource` não envia `Authorization`, e a autenticação é por Bearer token; usa-se um leitor de stream
  sobre `fetch` (`lib/sse.ts`, sem dependência nova) que renova o token em 401 e reconecta com backoff.
- Sem polling de status: o snapshot é recarregado ao receber `status.changed`.

### 6.8 API

| Rota | Acesso | Função |
|---|---|---|
| `GET …/revenue/harvey` | membros | snapshot: estado derivado, "fazendo agora", ciclos de hoje com metas × progresso, tempo em execução, pendentes de aprovação |
| `POST …/revenue/harvey/commands` | OWNER/ADMIN | 6.2 |
| `GET …/revenue/harvey/activities` | membros | paginação por cursor; filtros `phase`, `status`, `leadId`, `campaignId`, `after` |
| `GET …/revenue/harvey/stream` | membros | 6.7 |
| `GET/POST/PATCH …/revenue/campaigns[/:id]` | leitura membros, escrita OWNER/ADMIN | campanhas; PATCH valida fuso IANA, horário e metas ≥ 0; auditado |

Módulo novo `apps/api/src/modules/harvey/` (comandos, snapshot, atividades, stream, campanhas), registrado ao lado
de `RevenueModule`.

### 6.9 Interface

Nova aba **Harvey** como primeira aba de `revenue/` (`revenue/harvey`), e uma faixa de status no topo da Visão
geral com link para ela.

```
┌ Harvey · SDR da CazaTech ─────────────────────────────────────────────┐
│ ● PESQUISANDO   há 2h14 em execução (12 min pausado)    [Pausar] [Parar]│
│ Fazendo agora:                                                          │
│   ⟳ Pesquisando dentistas em Austin, TX                     há 40s      │
│   ⟳ Analisando o site de Smile Dental                       há 8s       │
├ Hoje · Campanha padrão (EUA, 09:00–18:00 America/New_York) ──────────┤
│ Pesquisados 18/30 ▓▓▓▓▓▓░░░  Qualificados 6/15 ▓▓▓░░░  Abordagens 3/10 │
│ Aguardando sua aprovação: 3 →                                           │
├ Atividades (ao vivo) ──────────────── [fase ▾] [status ▾] [lead 🔍] ──┤
│ 14:02 ✓ Smile Dental qualificado (72 pts)          Smile Dental →       │
│        Por quê: sem site · 4,8★ em 120 avaliações · telefone público    │
│ 14:01 ✓ Encontrou Smile Dental (novo lead)                              │
│ 13:58 ⏸ Rascunho para Bright Teeth pulado — Harvey pausado              │
└─────────────────────────────────────────────────────────────────────────┘
```

- Botões só aparecem quando o comando é válido para o estado; Parar pede confirmação explicando que o agente
  não volta sozinho amanhã.
- "Configurar" abre a campanha: metas, dias e horários, fuso, canais. E-mail é o único canal ativável; WhatsApp
  aparece desabilitado com "integração ainda não conectada (Fase 3)".
- Destaque das métricas: qualificados e oportunidades, não mensagens enviadas.
- `lib/harvey/` (tipos, hooks React Query, stream); chaves `['organizations', orgId, 'harvey', …]`.
- Página de alvos de prospecção ganha o seletor de campanha.

### 6.10 Pontos de extensão para as próximas fases

- **Memória comercial por lead (Fase 2)**: tabela própria (`LeadMemory`/fatos com fonte e data) ligada a `Lead`;
  a timeline já indexa por `leadId`, então o histórico do lead já é consultável.
- **Catálogo consultivo e múltiplas oportunidades (Fase 2)**: `Opportunity` (N por lead, com produto e histórico
  de troca de produto) ligada a `Lead`/`SalesCampaign`; `HarveyActivity` ganha `opportunityId` e novos `type`s.
  Nada na Fase 1 assume uma oferta por lead além do que já existe (`suggestedOfferingId`).
- **Conversas e transferência (Fases 3–4)**: `Conversation` (lead, canal, responsável `HARVEY|HUMAN`) e
  `ConversationMessage`; o `OutreachDispatchService` e o ponto de verificação ganham a regra "conversa assumida
  por humano → Harvey não envia". `HarveyActivity.channel` já existe.
- **Canais**: o registro `ChannelSender` e `SalesCampaign.enabledChannels` tornam WhatsApp um novo sender.
- **Campanhas BR × EUA**: idioma, fuso, país e canais já são da campanha.

## 7. Testes

- `packages/shared-types`: `resolveHarveyStatus` (matriz de estados), horário de trabalho e `cycleDate` por fuso
  (incluindo virada de dia e horário de verão), precedência de fases.
- `packages/database`: `checkHarveyMayProceed` (cada motivo de recusa).
- Worker: tick — abre um ciclo só com dois ticks concorrentes; não cria busca com agente pausado; respeita metas
  e `limit`; recuperação de atividade órfã; conclusão por meta e por horário; retomada redescobre leads
  pendentes. Processors pulam com `SKIPPED` quando pausado.
- API: comandos (tabela de transições, 409, RBAC, auditoria); dispatch (reivindicação concorrente, verificação
  final com agente pausado devolve a `APPROVED`, falha do provedor, `SENDING` órfão); stream (publicação →
  entrega só para a organização certa).
- E2E `apps/api/test/harvey.e2e-spec.ts`: fluxo iniciar → pausar → rascunho do Harvey pulado → envio bloqueado →
  retomar → trabalho pendente reenfileirado; isolamento entre organizações das 4 tabelas novas.
- E2E worker: duas instâncias do tick em paralelo contra o mesmo banco não duplicam ciclo nem `ScrapeJob`.
- `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e`, depois verificação no navegador.

## 8. Critérios de aceitação da Fase 1

1. A responsável abre Revenue Engine → Harvey e vê o agente parado.
2. Configura metas e horário da campanha padrão.
3. Inicia; em até 1 minuto a timeline mostra o ciclo começando e a busca em andamento, sem recarregar a página.
4. Leads novos, análises de site, qualificações e rascunhos aparecem como atividades com lead, resultado e
   justificativa.
5. Pausa; nenhuma busca, análise ou rascunho novo começa; um envio aprovado é recusado.
6. Retoma; os leads que ficaram pendentes são processados, sem atividade nem rascunho duplicado.
7. Para; no dia seguinte o agente não volta sozinho. Concluído por meta; no dia seguinte volta sozinho.
8. Com duas réplicas do worker rodando, nenhum ciclo, busca ou rascunho é duplicado.
9. Reiniciar worker e API no meio de um ciclo não perde histórico; atividades interrompidas aparecem como tal.

## 9. Deixado para quem implementa

- Formato exato dos títulos pt-BR de cada atividade e os ícones.
- Página de atividades: tamanho de página e retenção (sem expurgo nesta fase).
- Ordem do rodízio entre alvos (sugestão: o que rodou há mais tempo primeiro).

## 10. Decisões minhas a revisar

1. Com o Harvey pausado/parado, nenhum envio sai, inclusive manual (6.6).
2. Comandos restritos a OWNER/ADMIN; leitura para todos os membros.
3. Campanha padrão criada no backfill a partir de `defaultOutreachCountry`; `dailyResearchLimit` substituído pela
   meta da campanha.
4. Busca já em andamento termina e grava os leads mesmo após a pausa.
5. `SENDING` órfão nunca é reenviado automaticamente; vai para verificação humana.
6. Só os scans do Harvey migram para job scheduler nesta fase; os outros `setInterval` ficam para depois.
7. Horário de trabalho vale para todo trabalho do Harvey (pesquisa inclusive), não só para contato.
8. Análise de site e rascunho automático disparados por uma qualificação manual passam a depender do Harvey
   estar ativo (6.4).
