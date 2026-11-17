# Harvey Fase 1 — Controle do agente: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar a cadeia de jobs do Revenue Engine num agente (Harvey) que se inicia, pausa, retoma e
para pelo backend, com estado real, metas e horários por campanha, timeline persistente em tempo real e sem
duplicação entre réplicas nem envio duplicado.

**Architecture:** Orquestrador determinístico no worker (tick único via job scheduler do BullMQ) que reconcilia o
banco e enfileira os jobs existentes; cada job checa `checkHarveyMayProceed` antes de agir; atividades em
`HarveyActivity` publicadas por Redis pub/sub e entregues por SSE; envio passa por um dispatcher com reivindicação
atômica e verificação final do agente.

**Tech Stack:** NestJS, BullMQ 5.81 (`upsertJobScheduler`, `deduplication`), Prisma + Postgres (RLS), ioredis,
Next.js 14 + React Query, Jest.

**Spec:** `docs/superpowers/specs/2026-11-17-harvey-fase1-controle-design.md` (seções citadas como §).

## Global Constraints

- `apps/api` e `apps/worker` nunca importam um do outro; lógica pura em `packages/shared-types`, lógica com Prisma
  em `packages/database` (recebe `PrismaClient | Prisma.TransactionClient`).
- Toda tabela nova: `organization_id`, migration de tabela + migration `*_rls` separada no padrão de
  `20261116200100_revenue_engine_foundation_rls`.
- Nenhuma chamada de IA nova; nenhuma AI tool nova; aprovação de outreach continua só humana.
- Toda escrita de `Lead.status` continua gravando `PipelineStageTransition`.
- Comandos e escrita de campanhas: `@Roles('OWNER','ADMIN')` + `RolesGuard`; leitura: qualquer membro.
- Texto de interface e títulos de atividade em pt-BR. Comentários curtos (memória do projeto: código "nível pleno").
- Env nova (se houver) em três lugares: `.env.example`, `packages/config/env/schema.ts`, `turbo.json` `globalEnv`.
- Defaults da campanha: `workingDays {1,2,3,4,5}`, `workStartMinute 540`, `workEndMinute 1080`,
  `dailyResearchGoal 30`, `dailyQualifiedGoal 15`, `dailyOutreachGoal 10`, `enabledChannels {EMAIL}`.
- Intervalo do tick: 60 000 ms. Atividade órfã: 15 min. `SENDING` órfão: 10 min. Keep-alive SSE: 25 s.
- Canal Redis: `harvey:org:<organizationId>`.

## Review Focus

1. Pausa chegando entre a reivindicação do envio e a chamada ao provedor: a mensagem tem de voltar a `APPROVED` e
   nada sair (Task 7, teste `send blocked when agent paused after claim`).
2. Fuso e virada de dia: ciclo pausado atravessando a meia-noite do fuso da campanha, e horário de verão
   (Task 1 `cycleDateFor` DST; Task 8 `closes paused run when day ends`).
3. Duas réplicas executando o tick ao mesmo tempo: um ciclo e um `ScrapeJob` por alvo (Task 11 e2e worker).
4. Retomar depois de jobs pulados: o lead pulado tem de ser reenfileirado uma vez só (Task 8
   `resume re-enqueues skipped lead once`).
5. Stream de outra organização: um usuário nunca recebe evento de organização em que não é membro, e o stream
   não segura transação do Postgres (Task 6 `stream only delivers own org` e `stream route skips tenant
   transaction`).

---

### Task 1: Funções puras do Harvey (`packages/shared-types`)

**Files:**
- Create: `packages/shared-types/src/harvey.ts`, `packages/shared-types/src/harvey.spec.ts`
- Modify: `packages/shared-types/src/index.ts` (export)

**Interfaces:**
- Produces:
  - `type HarveyControlState = 'STOPPED' | 'ACTIVE' | 'PAUSED'`
  - `type HarveyRunStatus = 'RUNNING' | 'PAUSED' | 'STOPPED' | 'COMPLETED'`
  - `type HarveyPhase = 'RESEARCHING' | 'QUALIFYING' | 'PREPARING_OUTREACH' | 'SENDING' | 'RESPONDING' | 'CONTROL'`
  - `type HarveyDisplayStatus = 'IDLE' | 'RUNNING' | 'RESEARCHING' | 'QUALIFYING' | 'PREPARING_OUTREACH' | 'AWAITING_APPROVAL' | 'SENDING' | 'RESPONDING' | 'PAUSED' | 'STOPPED' | 'ERROR' | 'COMPLETED'`
  - `type HarveyCommand = 'START' | 'PAUSE' | 'RESUME' | 'STOP'`
  - `const HARVEY_ACTIVITY_TYPES` (as const) com os tipos da §6.4: `research.search`, `research.lead_found`,
    `research.site_analysis`, `qualification.score`, `qualification.offering_match`, `outreach.draft`,
    `outreach.awaiting_approval`, `outreach.sent`, `outreach.send_blocked`, `outreach.send_uncertain`,
    `outreach.reply_received`, `control.command`, `run.started`, `run.paused`, `run.resumed`, `run.stopped`,
    `run.completed`; `type HarveyActivityType`.
  - `interface WorkingHours { timezone: string; workingDays: number[]; workStartMinute: number; workEndMinute: number }`
  - `cycleDateFor(now: Date, timezone: string): string` → `'YYYY-MM-DD'` local.
  - `isWithinWorkingHours(now: Date, hours: WorkingHours): boolean`
  - `nextWorkStart(now: Date, hours: WorkingHours): Date`
  - `HARVEY_COMMAND_TRANSITIONS: Record<HarveyCommand, { from: HarveyControlState[]; to: HarveyControlState }>`
    (START: STOPPED→ACTIVE; PAUSE: ACTIVE→PAUSED; RESUME: PAUSED→ACTIVE; STOP: ACTIVE|PAUSED→STOPPED)
  - `resolveHarveyStatus(input: HarveyStatusInput): HarveyDisplayStatus` com
    `HarveyStatusInput = { controlState; everStarted: boolean; runs: { status: HarveyRunStatus; lastErrorAt: Date | null; lastSuccessAt: Date | null }[]; inProgressPhases: HarveyPhase[]; pendingApprovals: number; automaticWorkRemaining: boolean }`

- [ ] **Step 1: Escrever os testes**

```ts
describe('cycleDateFor', () => {
  it('uses campaign timezone', () =>
    expect(cycleDateFor(new Date('2026-11-18T02:30:00Z'), 'America/New_York')).toBe('2026-11-17'));
  it('handles DST start', () =>
    expect(cycleDateFor(new Date('2027-03-14T07:30:00Z'), 'America/New_York')).toBe('2027-03-14'));
});
describe('isWithinWorkingHours', () => {
  const h = { timezone: 'America/Sao_Paulo', workingDays: [1, 2, 3, 4, 5], workStartMinute: 540, workEndMinute: 1080 };
  it('inside', () => expect(isWithinWorkingHours(new Date('2026-11-18T12:00:00Z'), h)).toBe(true)); // qua 09:00 BRT
  it('end is exclusive', () => expect(isWithinWorkingHours(new Date('2026-11-18T21:00:00Z'), h)).toBe(false));
  it('weekend', () => expect(isWithinWorkingHours(new Date('2026-11-21T15:00:00Z'), h)).toBe(false));
  it('next start skips weekend', () =>
    expect(nextWorkStart(new Date('2026-11-20T22:00:00Z'), h).toISOString()).toBe('2026-11-23T12:00:00.000Z'));
});
describe('resolveHarveyStatus', () => {
  const base = { controlState: 'ACTIVE', everStarted: true, runs: [{ status: 'RUNNING', lastErrorAt: null, lastSuccessAt: null }], inProgressPhases: [], pendingApprovals: 0, automaticWorkRemaining: true } as const;
  it.each([
    [{ controlState: 'STOPPED', everStarted: false }, 'IDLE'],
    [{ controlState: 'STOPPED' }, 'STOPPED'],
    [{ controlState: 'PAUSED' }, 'PAUSED'],
    [{ inProgressPhases: ['RESEARCHING', 'PREPARING_OUTREACH'] }, 'PREPARING_OUTREACH'],
    [{ inProgressPhases: ['QUALIFYING', 'SENDING'] }, 'SENDING'],
    [{ pendingApprovals: 3, automaticWorkRemaining: false }, 'AWAITING_APPROVAL'],
    [{}, 'RUNNING'],
    [{ runs: [{ status: 'COMPLETED', lastErrorAt: null, lastSuccessAt: null }] }, 'COMPLETED'],
    [{ runs: [] }, 'IDLE'],
    [{ runs: [{ status: 'RUNNING', lastErrorAt: new Date(2), lastSuccessAt: new Date(1) }] }, 'ERROR'],
  ])('%o → %s', (patch, expected) => expect(resolveHarveyStatus({ ...base, ...patch } as HarveyStatusInput)).toBe(expected));
});
```

- [ ] **Step 2:** `pnpm --filter @opsmind/shared-types test -- harvey` → FAIL (módulo não existe).
- [ ] **Step 3:** Implementar em `harvey.ts`. Fuso via `Intl.DateTimeFormat(..., { timeZone, year, month, day, hour, minute, weekday, hourCycle: 'h23' }).formatToParts` (sem dependência nova). Precedência e regras exatamente como §6.5.
- [ ] **Step 4:** `pnpm --filter @opsmind/shared-types test -- harvey` → PASS.
- [ ] **Step 5:** Commit `feat(shared-types): estados, horários e transições do Harvey`.

---

### Task 2: Schema, migrations e backfill

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20261118120000_harvey_control/migration.sql`,
  `packages/database/prisma/migrations/20261118120100_harvey_control_rls/migration.sql`

**Interfaces:**
- Produces: models `SalesCampaign`, `HarveyAgent`, `HarveyRun`, `HarveyActivity`; enums `CampaignStatus`,
  `HarveyControlState`, `HarveyRunStatus`, `HarveyPhase`, `HarveyActivityStatus`; `OutreachStatus.SENDING`;
  colunas `ProspectingTarget.campaignId` (NOT NULL), `ScrapeJob.campaignId?/prospectingTargetId?/harveyRunId?`,
  `Lead.campaignId?`, `OutreachMessage.sendClaimedAt?`. Campos, defaults, uniques e índices exatamente como §6.1
  (tabelas `sales_campaigns`, `harvey_agents`, `harvey_runs`, `harvey_activities`).

- [ ] **Step 1:** Escrever o SQL: tabelas e enums; `CHECK (work_end_minute > work_start_minute)`; único
  (`organization_id`, `name`) em campanhas; único (`campaign_id`, `cycle_date`) em runs; único
  (`organization_id`, `idempotency_key`) em atividades; índice parcial `WHERE status = 'STARTED'`; índice único
  parcial `scrape_jobs (harvey_run_id, prospecting_target_id) WHERE harvey_run_id IS NOT NULL AND prospecting_target_id IS NOT NULL`.
- [ ] **Step 2:** Backfill no mesmo arquivo, nesta ordem: uma "Campanha padrão" por organização (país de
  `organization_revenue_settings.default_outreach_country`, default `US`; idioma/fuso: `US`→`en-US`/`America/New_York`,
  `BR`→`pt-BR`/`America/Sao_Paulo`, outros→`en-US`/`UTC`; `daily_research_goal` = `daily_research_limit` quando
  existir); `prospecting_targets.campaign_id` e `leads.campaign_id` (só `source_type <> 'MANUAL'`) apontando para
  ela; `ALTER ... SET NOT NULL` em `prospecting_targets.campaign_id`; uma linha `harvey_agents` `STOPPED` por
  organização.
- [ ] **Step 3:** Migration RLS: `ENABLE`/`FORCE ROW LEVEL SECURITY` e política `organization_id = current_setting('app.current_org_id', true)::uuid` (mesmo formato, incluindo o ramo `IS NULL`, da migration de RLS de referência) nas 4 tabelas; `GRANT` ao `opsmind_app`.
- [ ] **Step 4:** Atualizar `schema.prisma`; `pnpm --filter @opsmind/database exec prisma migrate dev` → aplica sem
  diff pendente; `pnpm --filter @opsmind/database exec prisma generate`.
- [ ] **Step 5:** `pnpm typecheck` → PASS (ajustar só tipos quebrados por `campaignId` obrigatório em
  `ProspectingTarget`: `ProspectingTargetsService.create` passa a exigir `campaignId`, Task 4 completa).
- [ ] **Step 6:** Commit `feat(database): campanhas, agente, ciclos e atividades do Harvey`.

---

### Task 3: Helpers de banco do Harvey (`packages/database`)

**Files:**
- Create: `packages/database/src/harvey.ts`
- Modify: `packages/database/src/index.ts`
- Test: `apps/worker/src/harvey-db.spec.ts` (o pacote `database` não tem Jest; o worker consome os helpers)

**Interfaces:**
- Consumes: Task 1 (`isWithinWorkingHours`, `cycleDateFor`), Task 2 models.
- Produces:
  - `type HarveyStep = 'research' | 'site_analysis' | 'qualification' | 'outreach_draft' | 'send'`
  - `checkHarveyMayProceed(db, { organizationId, campaignId: string | null, step: HarveyStep, now?: Date }): Promise<{ ok: true; runId: string | null } | { ok: false; reason: HarveySkipReason }>`
    com `HarveySkipReason = 'AGENT_PAUSED' | 'AGENT_STOPPED' | 'RUN_NOT_RUNNING' | 'OUTSIDE_WORKING_HOURS' | 'GOAL_REACHED' | 'BUDGET_EXCEEDED'`.
    Para `step: 'send'` só olha `controlState` (verificação final, §6.6). `campaignId` nulo (lead manual) → só
    `controlState`.
  - `HARVEY_SKIP_REASON_LABELS: Record<HarveySkipReason, string>` (pt-BR, ex. `AGENT_PAUSED: 'Harvey pausado'`).
  - `getRunProgress(db, runId): Promise<{ researched: number; qualified: number; prepared: number }>` — conta
    atividades `SUCCEEDED` do ciclo de tipo `research.lead_found`, `qualification.score` com `result.qualified = true`,
    `outreach.draft`.
  - `startHarveyActivity(db, input: StartActivityInput): Promise<HarveyActivity>` — upsert por
    (`organizationId`, `idempotencyKey`); se já existe finalizada, devolve sem alterar.
  - `finishHarveyActivity(db, id, { status, result?, rationale?, errorMessage? }): Promise<HarveyActivity>`
  - `recordHarveyEvent(db, input: StartActivityInput & { status: 'SUCCEEDED' | 'FAILED' | 'SKIPPED' }): Promise<HarveyActivity>` — atividade instantânea (`finishedAt = startedAt`).
  - `toHarveyActivityEvent(a: HarveyActivity): HarveyActivityEvent` (DTO serializável publicado e devolvido pela API; datas ISO).
  - `harveyChannel(organizationId: string): string` → `harvey:org:<id>`.
  - Run bookkeeping: `markRunSuccess(db, runId)`, `markRunError(db, runId, message)`.

- [ ] **Step 1: Testes** (Prisma mockado, mesmo estilo de `spend-alert-scan.spec.ts`):
  `blocks every step when agent paused` (reason `AGENT_PAUSED`), `blocks when no row (never started) as AGENT_STOPPED`,
  `send only checks control state` (ACTIVE fora do horário → ok), `outside working hours`, `research GOAL_REACHED when researched >= goal`,
  `outreach_draft GOAL_REACHED when prepared >= dailyOutreachGoal`, `startHarveyActivity is idempotent by key`
  (segunda chamada com mesma chave não cria outra linha).
- [ ] **Step 2:** `pnpm --filter @opsmind/worker test -- harvey-db` → FAIL.
- [ ] **Step 3:** Implementar; `research` também recusa quando `qualified >= dailyQualifiedGoal`; orçamento via
  `getEngineBudgetStatus` existente.
- [ ] **Step 4:** Mesmo comando → PASS.
- [ ] **Step 5:** Commit `feat(database): checkpoint e registro de atividades do Harvey`.

---

### Task 4: Campanhas na API

**Files:**
- Create: `apps/api/src/modules/harvey/campaigns.service.ts`, `campaigns.controller.ts`, `dto/campaign.dto.ts`,
  `campaigns.service.spec.ts`, `harvey.module.ts`
- Modify: `apps/api/src/app.module.ts` (registrar `HarveyModule`),
  `apps/api/src/modules/organizations/organizations.service.ts:27` (criar campanha padrão + `HarveyAgent` na
  transação de criação), `apps/api/src/modules/leads/prospecting-targets.service.ts` e DTO (`campaignId`
  obrigatório, validado como campanha da mesma organização)

**Interfaces:**
- Produces: `CampaignsService.list(orgId)`, `.create(orgId, dto, userId)`, `.update(orgId, id, dto, userId)`,
  `.getDefault(orgId)`; `createDefaultCampaign(tx, orgId, country = 'US')` exportado para o `OrganizationsService`.
  Rotas `GET/POST organizations/:organizationId/revenue/campaigns`, `PATCH .../campaigns/:campaignId`.

- [ ] **Step 1: Testes:** `rejects invalid IANA timezone` (`'Mars/Base'` → 400, validado com `Intl.supportedValuesOf('timeZone')`),
  `rejects end <= start`, `rejects negative goals`, `rejects enabledChannels outside OutreachChannel`, `update writes audit log harvey.campaign.updated`, `prospecting target with campaign of other org → 404`.
- [ ] **Step 2:** `pnpm --filter api test -- campaigns` → FAIL.
- [ ] **Step 3:** Implementar. Escrita `@Roles('OWNER','ADMIN')`. Metas são inteiros 0–1000.
- [ ] **Step 4:** Mesmo comando → PASS; `pnpm --filter api test -- prospecting-targets organizations` → PASS.
- [ ] **Step 5:** Commit `feat(harvey): campanhas de prospecção por organização`.

---

### Task 5: Comandos, snapshot e atividades

**Files:**
- Create: `apps/api/src/modules/harvey/harvey-control.service.ts`, `harvey.controller.ts`, `dto/harvey-command.dto.ts`,
  `harvey-control.service.spec.ts`, `apps/api/src/infrastructure/queue/harvey-orchestrator-queue.service.ts`
- Modify: `harvey.module.ts`, `packages/shared-types/src/queue-job-options.ts` (`HARVEY_ORCHESTRATOR_QUEUE = 'harvey-orchestrator'`)

**Interfaces:**
- Consumes: Tasks 1–4; `HarveyEventsPublisher.publish(orgId, event)` da Task 6 (injetar; nesta task usar um provider com a mesma assinatura que a Task 6 implementa — criar o arquivo `harvey-events.publisher.ts` com a classe e o método aqui, implementação real na Task 6).
- Produces:
  - `HarveyControlService.command(orgId, command: HarveyCommand, userId, reason?): Promise<HarveySnapshot>`
  - `HarveyControlService.snapshot(orgId): Promise<HarveySnapshot>` com
    `HarveySnapshot = { status: HarveyDisplayStatus; controlState; inProgress: HarveyActivityEvent[]; runs: { campaignId; campaignName; cycleDate; status; endReason; goals; progress; runningMs }[]; pendingApprovals: number; nextWorkStart: string | null; lastError: string | null }`
  - `HarveyControlService.listActivities(orgId, { cursor?, after?, phase?, status?, leadId?, campaignId?, limit = 50 })`
  - `HarveyOrchestratorQueueService.requestTick(orgId)` — `add('tick', { organizationId }, { deduplication: { id: 'tick:<orgId>' } })`.
  - Rotas: `GET .../revenue/harvey`, `POST .../revenue/harvey/commands`, `GET .../revenue/harvey/activities`.

- [ ] **Step 1: Testes:** `START from STOPPED → ACTIVE and requests tick`, `PAUSE marks RUNNING runs PAUSED with pausedAt`,
  `RESUME adds paused duration to pausedMs and reopens today's runs`, `STOP closes open runs with STOPPED_BY_USER`,
  `RESUME when STOPPED → 409 with current state`, `concurrent PAUSE: second gets 409` (updateMany count 0),
  `each command writes audit harvey.command.<cmd> and activity control.command and publishes`,
  `snapshot runningMs excludes paused time`.
- [ ] **Step 2:** `pnpm --filter api test -- harvey-control` → FAIL.
- [ ] **Step 3:** Implementar. Transição via `updateMany({ where: { organizationId, controlState: { in: from } }, data: { controlState: to, controlChangedAt, controlChangedByUserId, version: { increment: 1 } } })`. `everStarted` = existe algum `HarveyRun` da org. `automaticWorkRemaining` = leads da campanha `QUALIFIED` sem rascunho e com oferta sugerida, ou ciclo com pesquisa abaixo da meta. Comandos: `@Roles('OWNER','ADMIN')`.
- [ ] **Step 4:** Mesmo comando → PASS.
- [ ] **Step 5:** Commit `feat(harvey): comandos iniciar/pausar/retomar/parar e snapshot`.

---

### Task 6: Tempo real (publisher + SSE)

**Files:**
- Create: `apps/api/src/shared/decorators/skip-tenant-transaction.decorator.ts`,
  `apps/api/src/modules/harvey/harvey-events.publisher.ts` (implementação real), `harvey-events.subscriber.ts`,
  `harvey-events.subscriber.spec.ts`
- Modify: `apps/api/src/shared/interceptors/tenant-context.interceptor.ts` (+ spec), `harvey.controller.ts` (rota `stream`)

**Interfaces:**
- Produces: `@SkipTenantTransaction()`; `HarveyEventsPublisher.publish(orgId: string, event: HarveyStreamEvent): Promise<void>`;
  `HarveyEventsSubscriber.stream(orgId): Observable<MessageEvent>` (uma conexão Redis por instância,
  `psubscribe('harvey:org:*')`, `share()`); `HarveyStreamEvent = { kind: 'activity'; activity: HarveyActivityEvent } | { kind: 'status.changed' }`.
  Rota `@Sse('stream') GET .../revenue/harvey/stream` com `@SkipTenantTransaction()`; `MessageEvent.id` = id da atividade.

- [ ] **Step 1: Testes:** `stream route skips tenant transaction` (interceptor não chama `runInTransaction` com a metadata),
  `stream only delivers own org` (mensagem em `harvey:org:B` não chega no stream de A),
  `emits keep-alive every 25s` (fake timers), `publish serializes to channel`.
- [ ] **Step 2:** `pnpm --filter api test -- harvey-events tenant-context` → FAIL.
- [ ] **Step 3:** Implementar. Publicação sempre depois do commit (chamadores publicam após a transação retornar).
- [ ] **Step 4:** Mesmo comando → PASS.
- [ ] **Step 5:** Commit `feat(harvey): eventos em tempo real por SSE`.

---

### Task 7: Envio com reivindicação e verificação final; checkpoint no rascunho automático

**Files:**
- Create: `apps/api/src/modules/leads/outreach-dispatch.service.ts`, `outreach-dispatch.service.spec.ts`,
  `apps/api/src/modules/leads/channel-senders.ts`
- Modify: `apps/api/src/modules/leads/outreach.service.ts:552-620` (`send` delega), `outreach-autodraft.consumer.ts`
  (+ spec), `apps/api/src/modules/webhooks/resend-webhook.service.ts` (atividade `outreach.reply_received`),
  `apps/api/src/modules/leads/outreach.service.ts` (`generateDraft` com ator SYSTEM registra `outreach.awaiting_approval`)

**Interfaces:**
- Consumes: Task 3 helpers, Task 6 publisher.
- Produces: `interface ChannelSender { channel: OutreachChannel; send(input: { message; lead; organization }): Promise<{ providerMessageId: string }> }`;
  token `CHANNEL_SENDERS` (array; só `EmailChannelSender` registrado);
  `OutreachDispatchService.dispatch(orgId, messageId, userId): Promise<OutreachMessage>`.

- [ ] **Step 1: Testes** (`outreach-dispatch.service.spec.ts`):
  `claims APPROVED → SENDING atomically; second concurrent dispatch → 409`,
  `send blocked when agent paused after claim` (checkpoint `send` devolve `AGENT_PAUSED` → status volta a `APPROVED`, provedor não chamado, atividade `outreach.send_blocked`, 403),
  `provider failure reverts to APPROVED and keeps error`,
  `success → SENT with providerMessageId, idempotencyKey outreach-message/<id>, activity outreach.sent`,
  `channel without sender → 400 "canal não conectado"`.
  No spec do consumer: `skips with SKIPPED activity when Harvey paused` e `records outreach.draft STARTED→SUCCEEDED`.
- [ ] **Step 2:** `pnpm --filter api test -- outreach-dispatch outreach-autodraft outreach.service resend-webhook` → FAIL.
- [ ] **Step 3:** Implementar. Ordem exata do `dispatch`: reivindicar → checagens existentes do `send` atual (pausa
  global, liberação da org, teto diário, opt-out, endereço físico, warmup) → `checkHarveyMayProceed(step: 'send')` →
  provedor → `SENT`. Qualquer recusa depois da reivindicação devolve a `APPROVED`. No consumer, checkpoint antes do
  orçamento; atividade com `queueJobId = job.id` e `idempotencyKey = outreach.draft:<leadId>:<runId>`.
- [ ] **Step 4:** Mesmo comando → PASS.
- [ ] **Step 5:** Commit `feat(outreach): envio idempotente com verificação final do Harvey`.

---

### Task 8: Orquestrador no worker

**Files:**
- Create: `apps/worker/src/harvey-orchestrator.ts` (tick), `apps/worker/src/harvey-orchestrator.spec.ts`,
  `apps/worker/src/harvey-orchestrator-queue.ts`, `apps/worker/src/harvey-events.ts` (publish via ioredis)
- Modify: `apps/worker/src/main.ts` (remover `setInterval` de `runProspectingScan` e `runOutreachFollowupScan`;
  `upsertJobScheduler('harvey-tick', { every: 60_000 })` e `upsertJobScheduler('outreach-followup', { every: OUTREACH_FOLLOWUP_SCAN_INTERVAL_MS })`),
  `apps/worker/src/prospecting-scan.ts` (vira `pickNextTarget` + `createRunScrapeJob`, usado pelo tick; spec ajustado)

**Interfaces:**
- Consumes: Tasks 1, 3; filas `lead-scrape`, `website-profile`, `outreach-autodraft` (nomes já existentes).
- Produces: `runHarveyTick(deps: { prisma; redis; queues: { leadScrape; websiteProfile; outreachAutodraft }; now: () => Date; organizationId?: string }): Promise<HarveyTickSummary>`.

- [ ] **Step 1: Testes** (Prisma/filas mockados):
  `opens one run inside working hours and records run.started`,
  `does not open run when agent PAUSED or STOPPED`,
  `completes RUNNING run with HOURS_ENDED after workEnd`,
  `closes paused run when day ends` (`DAY_ENDED_WHILE_PAUSED`),
  `creates scrape job with limit=min(target.limit, remaining) and jobId scrape:<id>`,
  `no second scrape while one of the run is QUEUED/RUNNING`,
  `resume re-enqueues skipped lead once` (deduplication id `website-profile:<leadId>` / `outreach-autodraft:<leadId>`),
  `respects remaining outreach goal when enqueuing drafts`,
  `marks orphan STARTED activity FAILED after 15 min when its job is gone`,
  `flags SENDING older than 10 min with outreach.send_uncertain and notifies OWNER/ADMIN once`,
  `completes with GOALS_MET when qualified and prepared goals met and nothing in progress`,
  `skips org when advisory lock not acquired`.
- [ ] **Step 2:** `pnpm --filter @opsmind/worker test -- harvey-orchestrator prospecting-scan` → FAIL.
- [ ] **Step 3:** Implementar os passos 1–6 da §6.3 em funções separadas no mesmo arquivo (`ensureRuns`,
  `recoverOrphans`, `scheduleResearch`, `scheduleNextSteps`, `completeRuns`, `publishStatusIfChanged` — o último
  guarda o último status por org em Redis `harvey:status:<orgId>` e publica `status.changed` só quando muda).
  Advisory lock por org com `pg_try_advisory_xact_lock(hashtext('harvey:' || $1))` dentro de `withTenantContext`.
- [ ] **Step 4:** Mesmo comando → PASS; `pnpm --filter @opsmind/worker test` inteiro → PASS.
- [ ] **Step 5:** Commit `feat(worker): orquestrador do Harvey com scheduler único`.

---

### Task 9: Checkpoints e atividades nos processors do worker

**Files:**
- Modify: `apps/worker/src/lead-scrape-processor.ts:1408` (`processLeadScrapeJob`),
  `apps/worker/src/website-profiler-processor.ts:146` (`processWebsiteProfileJob`), specs correspondentes

**Interfaces:**
- Consumes: Task 3 helpers, `apps/worker/src/harvey-events.ts`.

- [ ] **Step 1: Testes:**
  scrape — `skips job of a paused Harvey run: ScrapeJob CANCELLED + research.search SKIPPED` (só quando `harveyRunId` não nulo; job manual roda como hoje),
  `records research.search STARTED→SUCCEEDED with {found, created, duplicates}`,
  `records research.lead_found per new lead, none for duplicates`,
  `records qualification.score with reasons from scoreBreakdown and qualification.offering_match with offering + strategy reasons`,
  `does not enqueue profile/autodraft when Harvey paused mid-job` (leads gravados mesmo assim),
  `sets Lead.campaignId from ScrapeJob.campaignId`;
  profiler — `skips with SKIPPED activity when paused`, `site_analysis rationale lists confirmed signals with quote and url`.
- [ ] **Step 2:** `pnpm --filter @opsmind/worker test -- lead-scrape-processor website-profiler-processor` → FAIL.
- [ ] **Step 3:** Implementar. Atividades gravadas na mesma transação curta já existente de cada fase; publicação
  depois do commit; `idempotencyKey` = `<type>:<entityId>[:<runId>]`.
- [ ] **Step 4:** Mesmo comando → PASS.
- [ ] **Step 5:** Commit `feat(worker): atividades e pausa do Harvey na pesquisa e análise de site`.

---

### Task 10: Interface do Harvey

**Files:**
- Create: `apps/web/lib/sse.ts`, `apps/web/lib/harvey/types.ts`, `apps/web/lib/harvey/use-harvey.ts`,
  `apps/web/lib/harvey/use-harvey-stream.ts`, `apps/web/app/organizations/[organizationId]/revenue/harvey/page.tsx`,
  `apps/web/components/harvey/` (`harvey-status-header.tsx`, `harvey-goals.tsx`, `harvey-timeline.tsx`,
  `harvey-activity-item.tsx`, `campaign-settings-dialog.tsx`, `harvey-status-strip.tsx`)
- Modify: `apps/web/app/organizations/[organizationId]/revenue/layout.tsx` (aba "Harvey" primeiro),
  `.../revenue/page.tsx` (faixa de status), `.../prospecting-targets/page.tsx` (seletor de campanha), `lib/nav-items.ts` se necessário

**Interfaces:**
- Consumes: rotas das Tasks 4–6.
- Produces: `openAuthenticatedStream(url, { onEvent, onOpen, signal }): () => void` em `lib/sse.ts` (fetch +
  `ReadableStream`, `Authorization` do `api-client`, refresh em 401, backoff 1s→30s); `useHarveySnapshot(orgId)`,
  `useHarveyActivities(orgId, filters)` (infinite), `useHarveyCommand(orgId)`, `useCampaigns(orgId)`,
  `useUpdateCampaign(orgId)`, `useHarveyStream(orgId)` (insere atividades no cache; ao reconectar busca `after=<último>`;
  invalida snapshot em `status.changed`).

- [ ] **Step 1:** Implementar `lib/sse.ts` e hooks; layout conforme esboço da §6.9 com os componentes de UI
  existentes (`components/ui`, padrão visual das abas de `revenue/`). Botões só para comandos válidos
  (`HARVEY_COMMAND_TRANSITIONS`); Parar com `alert-dialog` explicando que não reinicia sozinho; Pausar/Parar/
  Iniciar/Retomar e Configurar só visíveis para OWNER/ADMIN. WhatsApp desabilitado com "integração ainda não
  conectada (Fase 3)". Atividade: horário, título, status, duração, link do lead
  (`/organizations/<id>/leads/<leadId>`), "Por quê" expansível com `reasons` e evidências (URL clicável).
- [ ] **Step 2:** `pnpm --filter @opsmind/web typecheck && pnpm --filter @opsmind/web lint` → PASS.
- [ ] **Step 3:** Commit `feat(web): central de controle do Harvey com timeline ao vivo`.

---

### Task 11: E2E, verificação no navegador e documentação

**Files:**
- Create: `apps/api/test/harvey.e2e-spec.ts`, `apps/worker/test/harvey-orchestrator.e2e-spec.ts`
- Modify: `CLAUDE.md` (seção "Harvey (agente do Revenue Engine)": orquestrador, checkpoints, estados, campanhas,
  SSE, regra de que trabalho automático novo precisa passar por `checkHarveyMayProceed` e registrar atividade),
  `docs/superpowers/plans/2026-11-17-revenue-engine-roadmap.md` (nota apontando para a spec Harvey e o que mudou:
  `dailyResearchLimit` → meta da campanha, scans viraram scheduler)

- [ ] **Step 1: E2E API:** `start → pause → autodraft pulado → dispatch 403 → resume → snapshot RUNNING`;
  `VIEWER/MEMBER recebem 403 em commands e PATCH campaigns`; `org B não lê atividades/campanhas/runs/agent da org A`
  (as 4 tabelas, via RLS com `opsmind_app`); `stream entrega atividade publicada da própria org`.
- [ ] **Step 2: E2E worker:** `two concurrent ticks create one run and one scrape job per target` (duas chamadas
  `runHarveyTick` em paralelo com conexões Prisma separadas contra o mesmo banco).
- [ ] **Step 3:** `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e` → tudo PASS.
- [ ] **Step 4:** Subir `pnpm dev`, abrir Revenue Engine → Harvey no navegador e percorrer os critérios 1–7 da §8
  com uma campanha de teste (`sourceType MANUAL` não roda; usar alvo com fonte barata e `limit` 3). Registrar o
  resultado no PR.
- [ ] **Step 5:** Commit `docs: Harvey Fase 1 no CLAUDE.md e no roadmap`.
