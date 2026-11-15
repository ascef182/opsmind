# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

OpsMind — "AI-Powered Business Operations Platform": CRM + tasks + documents + automations, with an AI layer
(Claude tool-calling agent) that reads real business data and acts on it. pnpm/Turborepo monorepo. Docs in
Portuguese, code/comments in Portuguese; PRD and architecture detail live in `docs/planning/PRD.md`
(and `docs/planning/sprint-1-2-plan.md` for the Fase 1/2 decisions log — read it before changing early
architectural choices, since several non-obvious ones are recorded there with rationale).

## Commands

```bash
pnpm install
docker compose -f infra/docker/docker-compose.yml up -d   # Postgres (pgvector) + Redis
cp .env.example .env                                        # then fill in secrets
pnpm db:migrate                                              # prisma migrate dev, @opsmind/database
pnpm dev                                                     # turbo run dev, all apps (web on :3001, api on :3000)
```

Root scripts (all via Turborepo, fan out to every workspace that defines the task):
- `pnpm build` / `pnpm lint` / `pnpm typecheck` / `pnpm test`
- `pnpm test:e2e` — needs Postgres+Redis up and `.env` populated; not cached (`cache: false` in turbo.json)
- `pnpm db:studio`, `pnpm seed` — `@opsmind/database` only

Scope any task to one workspace with `pnpm --filter <name> run <script>` (package names: `@opsmind/api`,
`@opsmind/web`, `@opsmind/worker`, `@opsmind/database`, `@opsmind/config`, `@opsmind/shared-types`).

**Single test**: `pnpm --filter api test -- customers.service.spec` (Jest passes through); or `cd apps/api &&
npx jest customers.service.spec`. Unit specs sit next to the file they test (`*.spec.ts`); e2e specs live in
`apps/api/test` and `apps/worker/test` (`*.e2e-spec.ts`, run via `test:e2e`, separate Jest config).

**AI eval suite**: `pnpm --filter api eval` (= `apps/api/eval/run-eval.ts`) — spins up the full Nest app,
registers a user/org, seeds fixtures, and runs the chat endpoint against **real** Anthropic/OpenAI APIs (not
mocked) for tool-accuracy, RAG-grounding, hallucination-judge, and prompt-injection cases (`apps/api/eval/dataset.ts`).
Requires `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`. Runs against `claude-sonnet-5`, not the production
`claude-opus-5` — via `ANTHROPIC_MODEL=claude-sonnet-5` set in the npm script itself (setting it inside
`run-eval.ts` would be too late; `AppModule`'s `ConfigModule` resolves before that runs). Writes
`apps/api/eval-report.json`. Also runs in CI as its own job (`eval-suite` in `.github/workflows/ci.yml`), skipped
on fork PRs since they don't get repo secrets.

CI (`.github/workflows/ci.yml`) is the source of truth for the exact bring-up sequence against a fresh
Postgres: `prisma generate` → enable `pgvector` extension (`infra/docker/init/01-extensions.sql`) → `prisma
migrate deploy` → create the restricted `opsmind_app` role for RLS (`infra/docker/init/02-app-role.sql`) →
lint → typecheck → test → test:e2e. Reproduce that order locally if e2e tests fail against a fresh DB —
Docker Compose's local init scripts do this automatically, GitHub Actions `services:` does not.

## Architecture

Three deployables share two workspace packages:
- `apps/api` — NestJS. All business logic, REST endpoints, the AI chat/tools, RLS-transaction plumbing.
- `apps/web` — Next.js 14 (App Router). Thin client: React Query hooks in `lib/<domain>/use-*.ts` call
  `lib/api-client.ts`, which hits `apps/api`. No server-side business logic; domain types are duplicated
  locally per feature folder (`lib/<domain>/types.ts`) rather than imported from Prisma, deliberately — see
  the comment in `apps/web/lib/customers/types.ts`.
- `apps/worker` — BullMQ consumer for automations (`automation-processor.ts`, `automation-scan.ts`) and for
  lead scraping (`lead-scrape-processor.ts`, `lead-scrape-queue.ts`). Owns its own tenant-context helper
  (`apps/worker/src/tenant-context.ts`) separate from the API's, because jobs process one at a time (no
  concurrent-request AsyncLocalStorage needed) — see its own commented rationale.
- `packages/database` — Prisma schema (`schema.prisma`) + generated client, re-exported as `@opsmind/database`.
  Migrations are hand-annotated with the reasoning behind schema decisions; read the top-of-file comment
  before adding a model.
- `packages/shared-types` — cross-app DTOs/enums that *are* meant to be shared (e.g. `Role`, `ROLE_HIERARCHY`),
  plus pure domain functions with no framework dependency (e.g. `lead-scoring.ts`'s `scoreLead()`) that both
  `apps/api` and `apps/worker` need to agree on bit-for-bit.
- `packages/config` — Zod env schema (`env/schema.ts`, validated fail-fast at boot in both `main.ts` and
  `AppModule`) + shared eslint/tsconfig.
- `packages/integrations` (`@opsmind/integrations`) — external-API gateway classes
  (Apify/Explorium/camofox-browser) shared between `apps/api` and `apps/worker`, which can't import each
  other. Plain `new`-able classes, not NestJS providers — `apps/api` wraps them in DI tokens, `apps/worker`
  instantiates them directly.

### Multi-tenancy: defense in depth (this is the architecture to understand first)

Every tenant-owned table is scoped **twice**, independently:

1. **Application-level filtering** — every service method takes an explicit `organizationId` and filters by it.
2. **Postgres Row-Level Security**, enforced only because the API connects as a restricted role
   (`opsmind_app`, no `BYPASSRLS`) created by `infra/docker/init/02-app-role.sql` — never with `DATABASE_URL`
   (the migration-owner role, which bypasses RLS and must never be used at API runtime; only
   `DATABASE_URL_APP` is).

RLS depends on two Postgres session variables (`app.current_user_id`, `app.current_org_id`) that must be set
per-request. The mechanism, read in this order to understand it:

1. `TenantContextInterceptor` (global `APP_INTERCEPTOR`, `apps/api/src/shared/interceptors/`) opens one Prisma
   transaction per authenticated HTTP request, `SET LOCAL`s both session variables from `req.user`/
   `req.membership`, and stores the transaction client in `tenantContextStorage`
   (an `AsyncLocalStorage<Prisma.TransactionClient>`, `shared/context/tenant-context.storage.ts`).
2. `PrismaService` (`infrastructure/database/prisma.service.ts`) wraps itself in a `Proxy`
   (`createTenantAwareProxy`) at construction time: every `prisma.<model>.<method>()` call from *any* service
   transparently resolves against the active request's transaction when one exists, with zero awareness
   needed in the service code itself.
3. `TenantGuard` (`shared/guards/tenant.guard.ts`) validates `:organizationId` route params against
   `Membership` and attaches `req.membership` — this runs as a NestJS *guard*, which executes before the
   interceptor above, so RLS policies must tolerate an unset session variable for that one query (see the
   `IS NULL` branches documented at the top of `enable_row_level_security/migration.sql` — read that comment
   before touching any RLS policy, it explains a subtle empirically-confirmed Postgres GUC behavior).
4. `RolesGuard` + `@Roles(...WRITE_ROLES)` gate mutations; `canAssignRole()` (`shared/utils/can-assign-role.ts`)
   additionally blocks a user from granting/revoking a role equal-or-above their own.

`apps/worker` reimplements step 1/2 minimally for BullMQ jobs (`withTenantContext` in `tenant-context.ts`) since
it has no concurrent HTTP requests to isolate via `AsyncLocalStorage`.

When adding a new tenant-owned table: give it `organization_id`, write an RLS policy following the existing
pattern in the RLS migration, and never query it through a raw (non-proxied) Prisma client.

### AI module (`apps/api/src/modules/ai/`)

Manual agentic tool-calling loop (not the SDK's built-in loop) against `AiGateway`
(`gateway/ai-gateway.interface.ts`), an interface implemented by `ClaudeGatewayService` — services depend on
the interface, never the Anthropic SDK directly, so e2e/eval tests can substitute a different implementation.
`AiService.chat()` (`ai.service.ts`) loops up to `MAX_ITERATIONS` (8) calling tools and feeding results back;
persists every request + tool call to `AIRequest`/`AIRequestToolCall` for audit and the eval suite to read back.

Tools (`tools/*.tool.ts`, implement `AiTool` from `tools/ai-tool.interface.ts`) are the security boundary: a
tool's `inputSchema` never includes `organizationId`/`userId`/`role` as a model-controllable field — that
context (`AiToolContext`) is always injected by `AiService` from the authenticated request, the same way
`TenantGuard`/`@CurrentMembership()` inject it for normal routes. The model can never act outside what the
invoking user could already do. Document content retrieved via `search_documents` is treated as data to cite,
never as instructions — the system prompt explicitly tells the model to ignore embedded instructions
(prompt-injection defense), and the eval suite's `prompt-injection` category tests this against real documents.

`BudgetService` enforces a per-organization monthly spend cap (`Organization.aiMonthlyBudget`) before each
chat call; cost is estimated from token counts (`INPUT_COST_PER_MILLION_TOKENS`/`OUTPUT_COST_PER_MILLION_TOKENS`
in `ai.service.ts` — update these if pricing changes).

### Documents / RAG (`apps/api/src/modules/documents/`)

Upload → extract PDF text (`utils/extract-pdf-text.ts`) → chunk (`utils/chunk-text.ts`) → embed via
`EmbeddingGateway` (`gateway/embedding-gateway.interface.ts`, implemented by `OpenAiEmbeddingGateway` — OpenAI
because Anthropic has no embeddings endpoint) → store in `DocumentChunk` (pgvector). Upload is synchronous
(processes fully within the request) rather than queued through the worker.

### Leads / prospecção (`apps/api/src/modules/leads/`, `apps/web/.../leads`+`.../outreach`)

Feature de geração de pipeline: busca negócios locais por cidade/estado/tipo (priorizando quem não tem
site), qualifica automaticamente, e permite promover um `Lead` a `Customer`. `Lead` é uma entidade separada
de `Customer` (não polui o CRM com resultado bruto de busca) — segue o mesmo padrão RLS/multi-tenant de todo
o resto do schema, com um `convertedCustomerId` nullable marcando a promoção quando ocorre. O módulo da API
tem cinco serviços (`service-offerings`, `scrape-jobs`, `leads`, `outreach`, `lead-analysis`), mas só quatro
controllers (`service-offerings`, `scrape-jobs`, `leads`, `outreach-messages`) — `LeadAnalysisService` não
tem controller próprio, é injetado e exposto via `POST .../leads/:leadId/analyze` do `LeadsController`.

**Fontes de busca são plugáveis, escolhidas pelo usuário por `ScrapeJob.sourceType`** (`ScrapeSourceType`:
`APIFY_GOOGLE_MAPS`, `EXPLORIUM_BUSINESS_SEARCH`, `CAMOFOX_GOOGLE_SEARCH`, `CAMOFOX_REDDIT_SEARCH`, e
`MANUAL` que nunca chega a rodar/gerar custo). Apify (actor de Google Maps, dados estruturados:
telefone/rating/site/categoria), Explorium (a mesma API por trás das tools MCP "Vibe Prospecting" —
busca+enrichment B2B com firmografia), e camofox-browser (navegador stealth self-hosted,
https://github.com/jo-inc/camofox-browser, para cobertura ampla via macros como `@google_search`/
`@reddit_search`). `apps/worker/src/lead-scrape-processor.ts` despacha por um registry `SOURCE_REGISTRY:
Record<ScrapeSourceType, SourceHandler>`, nunca um switch crescente. Os três gateways vivem em
`packages/integrations` (`@opsmind/integrations`) — pacote necessário porque `apps/worker` não pode importar
módulos de `apps/api` e ambos processos precisam dos mesmos clients (worker faz busca em lote via
`lead-scrape-queue.ts`, api expõe enrich/analyze sob demanda de um lead específico).

**Scoring é híbrido e sempre determinístico** (nunca AI automática em massa — custaria budget sem controle
em milhares de leads por job): `scoreLead()` (função pura, `packages/shared-types/src/lead-scoring.ts`) usa
fórmula por firmografia quando o lead vem de fonte estruturada (Apify/Explorium), e cai para o fallback de
match de palavra-chave contra `ServiceOffering.signals` quando vem de fonte não-estruturada (Camofox) — a
mesma função é usada por `apps/worker` (scraping em lote) e `apps/api` (`/leads/:id/score` sob demanda) para
nunca divergir. Uma análise de IA por lead (`analyze_lead_potential`, opt-in, nunca automática) fica separada
do scoring — grava o resultado como `LeadEnrichment{type:'ai_analysis'}`, nunca muta `Lead` direto.

`apps/worker`'s `lead-scrape-processor.ts` diverge deliberadamente do padrão de uma-transação-só de
`automation-processor.ts`: usa 3 transações curtas (`withTenantContext`) ao redor de 1 fase sem transação (a
chamada de rede ao gateway externo), porque seria arriscado segurar uma transação Postgres aberta durante
uma chamada de rede potencialmente longa.

`OutreachMessage` (rascunho de contato gerado por IA) tem uma máquina de estados
(`DRAFT → APPROVED → SENT → REPLIED`, ou `DRAFT → REJECTED`/regenerate) cuja regra dura é: **aprovação é
sempre humana** — `OutreachService` (`outreach.service.ts`, comentário no topo do arquivo) só expõe
`approve`/`reject`/`regenerate`/`markSent`/`markReplied` via endpoint HTTP autenticado; não existe (e não
pode existir) uma AI tool `approve_outreach_message`/`send_outreach_message` — a única tool de IA para
outreach é `generate_outreach_message`, que sempre grava em `DRAFT` e nunca avança o status sozinha. A
máquina de estados reaproveita quase verbatim a de um branch anterior não mergeado
(`feat/prospecting-outbound`, focado em Reddit).

**4 AI tools novas** (`apps/api/src/modules/ai/tools/`: `find-leads`, `score-lead`, `analyze-lead-potential`,
`generate-outreach-message`), registradas no `AiModule` junto das já existentes — mesmo contrato de
`AiTool`/`AiToolContext` descrito acima. `score_lead` é gated por `WRITE_ROLES` (grava `Lead.score`, não é
read-only, apesar do nome sugerir uma consulta).

Frontend: páginas em `apps/web/app/organizations/[organizationId]/leads` (lista + detalhe) e `.../outreach`,
hooks em `lib/leads/use-*.ts`, componente de score com breakdown expansível
(`components/leads/lead-score-bar.tsx`), e um painel de pipeline de leads no dashboard
(`GET .../dashboard/leads`, `DashboardService.getLeadPipelineOverview()` — aditivo, não altera a rota/lógica
do dashboard original).

Plano completo desta feature (10 tasks): `docs/superpowers/plans/2026-09-02-leads-prospecting-dashboard.md`.

### Env / config

`packages/config/env/schema.ts` is the single Zod schema validated fail-fast at boot (`main.ts` and again via
`ConfigModule.forRoot({ validate })` in `AppModule`). Two deliberate categories:
- **Required**: `DATABASE_URL`/`DATABASE_URL_APP`/`REDIS_URL`/JWT secrets/`PORT`/`CORS_ORIGIN` — the app
  refuses to boot without these.
- **Optional, fail-late**: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` — features (AI chat, document upload) that
  don't exist yet in every environment fail clearly on first real use instead of blocking the whole API's boot.

New env vars need to land in three places: `.env.example`, the Zod schema, and `turbo.json`'s `globalEnv`
(so Turborepo's cache correctly invalidates on env changes).

### RBAC

Five roles, `packages/shared-types` `ROLE_HIERARCHY`: `OWNER > ADMIN > MANAGER > MEMBER > VIEWER` (most to
least privileged). `WRITE_ROLES` (`shared/constants/roles.constant.ts`) = everyone except `VIEWER` — CRM/task
work is operational, not account administration, so most roles can write. Membership/role-management actions
go through `canAssignRole()`, not a raw hierarchy comparison in the controller.

### Observability

Sentry (`@sentry/nestjs`, `@sentry/node`) wired as `SentryGlobalFilter`, first `APP_FILTER` registered.
Structured logging via `nestjs-pino` (`infrastructure/logging/logger-options.ts` — JSON in production,
`pino-pretty` in dev).
