-- Revenue Engine, Fase 1 — fundação: histórico de estágios do funil, razão
-- de custos, configuração por organização e `ai_requests.operation`.
-- Escrita à mão e aplicada com `prisma migrate deploy` (mesmo motivo de
-- 20260902120000_leads_prospecting: o shadow database não tem `vector`).
--
-- `pipeline_stage_transitions` e `cost_events` não têm FK para leads/deals de
-- propósito: são históricos append-only e precisam sobreviver à linha de
-- origem. Estágios ficam em TEXT porque usam o funil unificado de
-- `REVENUE_PIPELINE_STAGES` (@opsmind/shared-types), que cruza `LeadStatus`
-- e `DealStage`.

-- CreateEnum
CREATE TYPE "CostCategory" AS ENUM ('AI', 'SCRAPING', 'ENRICHMENT', 'EMAIL', 'SMS', 'WHATSAPP', 'PREVIEW', 'STORAGE', 'HOSTING');

-- AlterTable
ALTER TABLE "ai_requests" ADD COLUMN "operation" TEXT;

-- CreateTable
CREATE TABLE "pipeline_stage_transitions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "lead_id" TEXT,
    "deal_id" TEXT,
    "from_stage" TEXT,
    "to_stage" TEXT NOT NULL,
    "actor_type" "AuditActorType" NOT NULL,
    "actor_id" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pipeline_stage_transitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_events" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "category" "CostCategory" NOT NULL,
    "provider" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "agent" TEXT,
    "quantity" DECIMAL(12,2) NOT NULL DEFAULT 1,
    "amount_usd" DECIMAL(12,6) NOT NULL,
    "lead_id" TEXT,
    "deal_id" TEXT,
    "scrape_job_id" TEXT,
    "ai_request_id" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cost_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_revenue_settings" (
    "organization_id" TEXT NOT NULL,
    "outreach_paused" BOOLEAN NOT NULL DEFAULT true,
    "outreach_paused_reason" TEXT,
    "daily_send_limit" INTEGER NOT NULL DEFAULT 20,
    "daily_research_limit" INTEGER NOT NULL DEFAULT 40,
    "engine_monthly_budget_usd" DECIMAL(10,2) NOT NULL DEFAULT 50,
    "default_outreach_country" TEXT NOT NULL DEFAULT 'US',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_revenue_settings_pkey" PRIMARY KEY ("organization_id")
);

-- CreateIndex
CREATE INDEX "pipeline_stage_transitions_organization_id_to_stage_occurred_at_idx" ON "pipeline_stage_transitions"("organization_id", "to_stage", "occurred_at");
CREATE INDEX "pipeline_stage_transitions_organization_id_occurred_at_idx" ON "pipeline_stage_transitions"("organization_id", "occurred_at");
CREATE INDEX "pipeline_stage_transitions_lead_id_occurred_at_idx" ON "pipeline_stage_transitions"("lead_id", "occurred_at");
CREATE INDEX "pipeline_stage_transitions_deal_id_occurred_at_idx" ON "pipeline_stage_transitions"("deal_id", "occurred_at");
CREATE INDEX "cost_events_organization_id_occurred_at_idx" ON "cost_events"("organization_id", "occurred_at");
CREATE INDEX "cost_events_organization_id_category_occurred_at_idx" ON "cost_events"("organization_id", "category", "occurred_at");
CREATE INDEX "cost_events_lead_id_idx" ON "cost_events"("lead_id");

-- AddForeignKey
ALTER TABLE "pipeline_stage_transitions" ADD CONSTRAINT "pipeline_stage_transitions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cost_events" ADD CONSTRAINT "cost_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "organization_revenue_settings" ADD CONSTRAINT "organization_revenue_settings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: uma linha por lead/deal existente com o estágio ATUAL. Não há
-- como reconstruir o caminho anterior (nunca foi gravado), então o histórico
-- real começa aqui; `occurred_at` usa a melhor data disponível
-- (`updated_at` do lead, `stage_entered_at` do deal). Lead CONVERTED não
-- entra: o deal criado na conversão carrega o estágio dali em diante.
INSERT INTO "pipeline_stage_transitions" ("id", "organization_id", "lead_id", "to_stage", "actor_type", "occurred_at")
SELECT gen_random_uuid()::text, l."organization_id", l."id",
  CASE l."status"
    WHEN 'OUTREACH_DRAFTED' THEN 'OUTREACH_READY'
    WHEN 'OUTREACH_APPROVED' THEN 'OUTREACH_READY'
    ELSE l."status"::text
  END,
  'SYSTEM', l."updated_at"
FROM "leads" l
WHERE l."status" <> 'CONVERTED';

INSERT INTO "pipeline_stage_transitions" ("id", "organization_id", "lead_id", "deal_id", "to_stage", "actor_type", "occurred_at")
SELECT gen_random_uuid()::text, d."organization_id", d."origin_lead_id", d."id",
  CASE d."stage"
    WHEN 'QUALIFICATION' THEN 'MEETING_SCHEDULED'
    WHEN 'PROPOSAL' THEN 'PROPOSAL_SENT'
    WHEN 'CONTRACT_SENT' THEN 'NEGOTIATION'
    ELSE d."stage"::text
  END,
  'SYSTEM', d."stage_entered_at"
FROM "deals" d
WHERE d."deleted_at" IS NULL;
