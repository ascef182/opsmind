# CazaTech Revenue Engine — architecture and phased plan

> Status (2026-11-17): Phase 1 implemented on `feat/revenue-engine-fase1` (commits 433e929..b15aff9).
> Deviation from 1.6: the funnel tab is a table (one row per stage) instead of 15 read-only columns.
> Not done in Phase 1: Step 0's PR for the Harvey Fase 7 branch (the new branch is stacked on it).

## Context

CazaTech wants OpsMind to become its internal acquisition engine for US local businesses (dentists, roofing,
HVAC, landscaping, etc.): research every day, score the opportunity, write research-based email outreach, read
replies, generate a demo website for interested prospects, and hand a human a deal to close, with every cost
measured. Humans approve anything that is sent or promised.

The audit showed most of the skeleton exists (scraping with dedup, deterministic scoring, website profiler,
human-approved outreach over Resend with warmup and a reply webhook, deals with Kanban, AI proposals with PDF and
e-signature, AI budget). The plan therefore extends what is there instead of adding a parallel system.

Decisions already made with the user:
- Not deployed anywhere yet. Deployment becomes an explicit step before any real sending.
- Website previews: in-house static HTML from niche templates, behind a provider interface.
- Budget ceiling: about US$50/month for research + AI + email. Defaults and model choices follow from this.
- No outreach domain exists. Sending stays disabled until one is bought and verified.

My calls (not user decisions):
- One funnel computed from `Lead.status` + `Deal.stage` (both extended) plus a transition-history table. No third
  pipeline entity.
- The "8 agents + orchestrator" are named operations on the existing BullMQ queues with a shared AI runner and a
  cost tag per agent. The orchestrator is the pipeline state machine, not an LLM directing other LLMs: at US$50 a
  month, an LLM orchestrator would spend the budget on coordination.
- UI stays pt-BR; outreach language follows the lead's country.
- This file is the roadmap for all 8 phases with Phase 1 executable. Each later phase gets its own detailed plan
  (`docs/superpowers/plans/`) when reached, after the previous phase is validated.

## Step 0 — close the current branch

`feat/harvey-fase7-gatilho-qualificacao` has uncommitted review fixes that look complete but were never run.
1. Run `pnpm --filter api test`, `pnpm --filter @opsmind/shared-types test`, `pnpm --filter api test:e2e`.
2. Commit the 10 modified files. Leave the deleted `Dark Mode SaaS Financial Dashboard…png` out of the commit
   (looks unrelated; ask before removing it from the repo).
3. Open the PR to `main`; start `feat/revenue-engine-fase1` from it.

## Agent map (what each "agent" is in code)

| Agent | Implementation | AI use |
|---|---|---|
| Market Research | `ProspectingTarget` scan + `lead-scrape` queue + `SOURCE_REGISTRY` | none |
| Business Intelligence | `website-profile` queue + contact enrichment | none (regex), optional routine-tier summary |
| Lead Scoring | `scoreLead()` extended (pure, deterministic) | none |
| Outreach Copywriting | `OutreachService.generateDraft` via `outreach-autodraft` | standard tier |
| Conversation Intelligence | new `reply-classify` consumer | routine tier |
| Website Generation | new `website-preview` consumer + provider interface | standard tier |
| Proposal | `DealProposalService` + pricing/margin function | standard tier |
| Performance Optimization | weekly deterministic report + short AI summary | routine tier |

Every AI call goes through one shared runner; every run writes an `AIRequest` (with `operation`) and a `CostEvent`.

## Phase 1 — foundation and dashboard (detailed)

No external spend. Nothing here sends anything.

### 1.1 Database (hand-written SQL, table migration followed by a separate `*_rls` migration, same pattern as `20260914120000_deals` / `20260914120100_deals_rls`)

- `PipelineStageTransition`: `organizationId, leadId?, dealId?, fromStage?, toStage, actorType, actorId?,
  occurredAt`. Stages stored as text using the 15 mission stages. Index `(organizationId, toStage, occurredAt)`.
  Backfill one row per existing lead (current status at `createdAt`) and per deal (`stageEnteredAt`).
- `CostEvent`: `organizationId, category (AI|SCRAPING|ENRICHMENT|EMAIL|SMS|WHATSAPP|PREVIEW|STORAGE|HOSTING),
  provider, operation, agent?, quantity, amountUsd numeric(12,6), leadId?, dealId?, scrapeJobId?, aiRequestId?,
  occurredAt`. Append-only.
- `AIRequest.operation` (nullable text), e.g. `outreach.draft`, `reply.classify`.
- `OrganizationRevenueSettings` (1:1 with Organization): `outreachPaused` (default **true**), `outreachPausedReason`,
  `dailySendLimit`, `engineMonthlyBudgetUsd` (default 50), `dailyResearchLimit`, `defaultOutreachCountry`.

### 1.2 Shared code

- `packages/shared-types/src/revenue-pipeline.ts`: `REVENUE_PIPELINE_STAGES` and pure
  `resolvePipelineStage({leadStatus, dealStage})`. Mapping: `OUTREACH_DRAFTED|OUTREACH_APPROVED → OUTREACH_READY`;
  deal `QUALIFICATION → MEETING_SCHEDULED`, `PROPOSAL → PROPOSAL_SENT`, `NEGOTIATION|CONTRACT_SENT → NEGOTIATION`.
  Also `nextRecommendedAction(stage)` (deterministic text per stage).
- `packages/database`: `recordStageTransition(tx, …)` and `recordCostEvent(tx, …)` taking a Prisma transaction
  client, so `apps/api` and `apps/worker` share them (they cannot import each other).
- Call `recordStageTransition` wherever status is written: `LeadsService.update/score/discardByScrapeJob/
  convertToCustomer`, `OutreachService` lead side effects, `DealsService.moveStage` (next to the existing
  `deal.stage_changed` audit), worker `upsertLead` and `website-profiler-processor`.

### 1.3 AI plumbing (`apps/api/src/modules/ai/`)

- `AiGatewayRequest` gains optional `model`, `maxTokens`, `thinking`. `ClaudeGatewayService` honours them and keeps
  `ANTHROPIC_MODEL` as the default.
- Model tiers by env: `ANTHROPIC_MODEL_ROUTINE`, `ANTHROPIC_MODEL_STANDARD` (three places: `.env.example`, Zod
  schema, `turbo.json` — also add the missing `ANTHROPIC_MODEL`, `SENTRY_DSN`, `LOG_LEVEL` to `globalEnv`). Model
  ids and prices are taken from current Anthropic pricing at implementation time and added to
  `AI_MODEL_PRICING` (`packages/shared-types/src/ai-model-pricing.ts`); the eval judge model gets a price too.
- New `AiOneShotRunner`: budget check → gateway call → `AIRequest` out-of-band → `recordSpend` → `CostEvent`.
  Migrate the four hand-copied call sites to it: `LeadAnalysisService`, `OutreachService.generateDraft`,
  `DealProposalService.generate`, `RedditClusteringConsumer`. This fixes proposal cost never reaching the budget
  and proposal error rows being lost on rollback.
- Budget alerts: at 50/80/100 % of `aiMonthlyBudget` and of `engineMonthlyBudgetUsd` (month-to-date sum of
  `CostEvent`), create a `Notification` for OWNER/ADMIN, once per threshold per month (Redis `SET NX`). At 100 %
  of the engine budget, research scans and autodrafts skip.

### 1.4 Cost capture and reliability

- Worker `finalizeJob` and contact enrichment write `CostEvent` (keeping the Redis counter). `OutreachService.send`
  writes an EMAIL `CostEvent`.
- BullMQ default job options: `attempts: 3`, exponential backoff, `removeOnComplete/Fail` on `website-profile`,
  `outreach-autodraft`, `reddit-clustering`, `reddit-topic-scan`. `lead-scrape` stays at 1 attempt (a retry would
  pay the provider twice). Correct the comments that assume retries.
- Pause switch: `OutreachService.send()` refuses when `outreachPaused` is true or env `OUTREACH_GLOBAL_PAUSE=true`.

### 1.5 API — new `apps/api/src/modules/revenue/`

- `GET organizations/:id/revenue/overview?period=day|week|month` — the mission's KPI list, each with current and
  previous period. KPIs whose source arrives in a later phase (positive replies, demos, previews) return 0 and
  are marked `availableFrom`.
- `GET …/revenue/pipeline` — count per stage, stage-to-next conversion, median time in stage, next action.
- `GET …/revenue/costs` — spend by category and day; cost per researched lead, per qualified lead, per positive
  reply, per won customer.
- `GET/PATCH …/revenue/settings` — PATCH restricted to OWNER/ADMIN, audited.

### 1.6 Web — `apps/web/app/organizations/[organizationId]/revenue/`

- `layout.tsx` with link tabs copied from `finance/layout.tsx`: Visão geral, Pipeline, Custos, Configurações.
  Header "CazaTech Revenue Engine". One entry in `lib/nav-items.ts`.
- Move `KpiCard`, `DeltaBadge`, `buildDailySeries`, `computeDelta` out of `dashboard/page.tsx` into
  `components/dashboard/kpi.tsx` and reuse; charts from `components/ui/chart-card.tsx`.
- Pipeline tab: 15 read-only columns with horizontal scroll (the deal Kanban stays the place to drag deals).
- Settings tab: pause switch with confirmation, budgets, limits. Add shadcn `switch` and `alert-dialog`.
- Hooks in `lib/revenue/use-revenue.ts`, types in `lib/revenue/types.ts`, keys `['organizations', orgId, 'revenue', …]`.

### 1.7 Acceptance and tests

- Moving a lead or deal through any path produces exactly one transition row; funnel counts equal the live
  `Lead.status`/`Deal.stage` counts.
- One outreach draft produces one `AIRequest` with `operation` and one `CostEvent`; a proposal now moves the budget
  counter.
- With the pause on (default), `POST …/outreach-messages/:id/send` returns 403.
- Unit specs: `revenue-pipeline.spec.ts`, `AiOneShotRunner`, `RevenueService`, updated specs of the four migrated
  services. E2E: `apps/api/test/revenue.e2e-spec.ts` including cross-org isolation of the new tables.
- `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e`, then open the dashboard in the browser.

## Sales Copy Intelligence (done 2026-11-17, between Phase 1 and 2)

Requested after the team rated the first 18 real drafts 7/10 (assumptions stated as facts, artificial
compliments, long first messages). Root cause: the v2 prompt required a "pain/cost" sentence in every message.

- Deterministic strategy per lead (`selectOutreachStrategy`): no website, outdated website, weak conversion,
  WhatsApp automation (no website + WhatsApp only for WhatsApp-heavy segments, user decision), strong presence
  (autodraft skipped), general (site not investigated). Offer chosen by `ServiceOffering.kind`.
- Prompt v3.1: verified facts vs. unverified hypotheses, site signals with quote and URL, 60–100 words, phone
  call script in three blocks, never claim a concept already exists.
- Quality control before saving: banned phrases/length/similarity in code + Haiku reviewer (6 scores, unsupported
  claims), up to 3 versions, fabricated claims never saved.
- Learning loop: `strategy`, `quality_review`, `original_body`, `prompt_version` on each draft;
  `GET .../revenue/copy-performance` ranks strategies by won/meetings; replied messages become style references once
  a strategy×channel has 3.
- Regeneration of the 18 drafts + 3 leads (`apps/api/scripts/regenerate-outreach-drafts.ts`) stopped at 12 when
  the Anthropic account ran out of credit; 6 drafts + 3 leads pending. Rate limit/budget note: real cost was about
  US$0.035 per lead (more attempts than estimated).

## Phase 2 — market research and lead intelligence

- DB: `Lead.country` (backfill `BR`), `Lead.googleMapsUrl`, `Lead.fieldConfidence Json`; `ProspectingTarget.country`
  and niche; normalised-phone dedup key.
- Seed US targets for the ten niches; daily cap from `dailyResearchLimit`.
- Replace `setInterval` scans in `apps/worker/src/main.ts` with BullMQ job schedulers so a second worker replica
  does not double-run.
- Profiler for US sites: `/contact`, English patterns, new signal codes (parked/broken site, no booking or call
  CTA, social-only presence, slow or non-mobile page).
- Integration: Apify mapping verified (2026-11-17) against existing runs of `compass/google-maps-extractor` in the
  CazaTech Apify account, at no cost. Fixed then: full state names normalised to abbreviations, `""` phone/website
  treated as absent, cost billed per returned place. Social-only "websites" (Facebook, Instagram,
  WhatsApp, link-in-bio) now count as no website and become a social link (`classifyBusinessWebsite`); 21
  existing leads that were wrongly DISQUALIFIED were reset to DISCOVERED for re-scoring.
- Cost: US$0.005 per returned place on the Free tier (30 places = US$0.15). At ~40 places/day: ~US$6/month.
- Acceptance: a daily run creates deduplicated US leads with source, timestamp and confidence; reruns create no
  duplicates; spend appears in `CostEvent`.
- Tests: processor specs with fixture payloads for US results; dedup cases; scheduler idempotency.

## Phase 3 — qualification and opportunity score

- Extend `scoreLead()` additively (website quality from signals, contact availability, review volume) and add
  `priority` HIGH ≥ 70, MEDIUM 40–69, LOW < 40 plus a `reasons[]` array, so the "why" is deterministic and free.
- DB: `LeadOpportunity` (from PRD Fase 9): `opportunityTypes, recommendedOfferingId, recommendedChannel,
  estimatedDealValue, currency, researchSummary`; `ServiceOffering` price range per currency; `LeadStatus` gains
  `RESEARCHED`.
- AI research summary only for HIGH and MEDIUM, routine tier, capped per day.
- Lead detail page gets the opportunity panel; leads list gets a priority filter.
- Cost: under US$5/month. Acceptance: every researched lead has score, priority, reasons and recommended service;
  existing scoring specs still pass. Tests: scoring spec matrix, no-regression fixtures for current BR leads.

## Deployment gate (before Phase 4)

Webhooks and unsubscribe links need a public URL. Fix the Dockerfiles (they omit `packages/integrations`), add an
S3-compatible `StorageService` implementation, deploy api + worker + web + Postgres (pgvector) + Redis.
Recommendation: Railway (about US$5–20/month, outside the US$50 engine budget). Buy the outreach domain, verify
SPF/DKIM/DMARC and inbound in Resend. Sending stays paused until all of this is checked.

## Phase 4 — email outreach and reply monitoring

- Prompt: move the hardcoded CazaTech lines in `outreach.service.ts` to org settings + `ServiceOffering`; English
  for US leads; evidence from `LeadSignal.evidenceQuote/evidenceUrl` (Harvey Phase 4, still open); guardrails for
  English and a rule against claiming a site already exists.
- Compliance: `SuppressionEntry` (email or domain) checked in `send()`; `List-Unsubscribe` header and a public
  one-click endpoint with a signed token; physical address footer (already required); per-org daily send limit;
  daily SPF/DKIM/DMARC check that blocks sending on failure.
- Replies: `InboundMessage` table storing the reply; fix matching (the webhook compares Resend's API id with
  `In-Reply-To`; set and store our own Message-ID and confirm with a real reply); routine-tier classification into
  the nine mission classes; opt-out replies suppress automatically; "wants a demo" moves the lead to
  `DEMO_REQUESTED`; suggested reply saved as a DRAFT for human approval.
- Follow-ups: at most two, created as drafts. Still no AI tool that approves or sends.
- `LeadStatus` gains `INTERESTED`, `DEMO_REQUESTED`. Guard the unguarded `Lead.status` writes in `approve/send/
  markReplied`.
- Cost: Resend free tier or US$20/month, domain about US$12/year, AI about US$15/month at 20 drafts a day.
- Acceptance: an approved email is sent with unsubscribe; a real reply is stored, classified and shown in the
  outreach inbox; an unsubscribe click blocks future sends. Tests: webhook e2e with signed fixtures, classifier
  eval cases added to `apps/api/eval/dataset.ts`, suppression unit specs.

## Phase 5 — website preview generation

- DB: `WebsitePreview` (`leadId, status GENERATING|READY|APPROVED|FAILED|EXPIRED, brief Json, templateKey,
  storageKey, tokenHash, provider, costUsd, reviewedByUserId, expiresAt`); `LeadStatus` gains `PREVIEW_GENERATING`,
  `PREVIEW_READY`.
- `WebsitePreviewProvider` interface with one implementation: brief from the research record, one of a few niche
  templates, standard-tier model fills copy and sections, static HTML stored in the bucket.
- API-side `website-preview` consumer (AI consumers already live in the API). Served at a private token URL with
  `noindex`, a visible "demo concept by CazaTech" banner, strict CSP with no scripts, stock or placeholder imagery
  only (no prospect logos or photos), 30-day expiry.
- Review screen: operator approves before the link can be shared; notification when ready.
- Cost: roughly US$0.10–0.50 per preview. Acceptance: demo request to reviewed preview without manual steps other
  than approval. Tests: provider spec with mocked gateway, HTML sanitisation spec, token access e2e.

## Phase 6 — proposals and conversion analytics

- `OfferPackage` per currency (USD priced on its own, never converted from BRL) and a pure cost/margin function
  (hours, infra, AI) that runs before any price is suggested; `DealProposalService` uses it.
- Proposal approval step before send; `LeadOutcomeFeedback` snapshot at won/lost; conversion by score band and
  cost per acquired customer on the dashboard.

## Phase 7 — additional channels

Written evaluation first (providers, cost, TCPA and Meta policy). Then gateway interfaces in
`packages/integrations`, `ContactConsent` records, WhatsApp only for opted-in or prospect-initiated conversations,
SMS only with recorded consent. Each channel off by default.

## Phase 8 — optimisation

Weekly report of cost per qualified lead and reply rate by niche and city, with a short AI summary and suggested
target changes that a human accepts; prompt caching on shared system prompts; subject-line experiments.

## Verification (Phase 1)

1. `docker compose -f infra/docker/docker-compose.yml up -d`, `pnpm db:migrate`, `pnpm seed`.
2. `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e`.
3. `pnpm dev`; in the browser open `/organizations/<id>/revenue`: KPIs render with deltas, funnel counts match the
   leads and deals pages, settings show outreach paused.
4. Score a lead, generate a draft, move a deal: check new rows in `pipeline_stage_transitions`, `cost_events`,
   `ai_requests.operation` via `pnpm db:studio`.
5. Try to send an approved email with the pause on: expect 403.
