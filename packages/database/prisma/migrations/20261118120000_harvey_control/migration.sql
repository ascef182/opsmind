-- Harvey Fase 1 — controle do agente: campanhas, estado do agente, ciclos
-- diários e atividades. Escrita à mão e aplicada com `prisma migrate deploy`
-- (o shadow database não tem `vector`). Ver
-- docs/superpowers/specs/2026-11-17-harvey-fase1-controle-design.md §6.1.

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "HarveyControlState" AS ENUM ('STOPPED', 'ACTIVE', 'PAUSED');

-- CreateEnum
CREATE TYPE "HarveyRunStatus" AS ENUM ('RUNNING', 'PAUSED', 'STOPPED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "HarveyPhase" AS ENUM ('RESEARCHING', 'QUALIFYING', 'PREPARING_OUTREACH', 'SENDING', 'RESPONDING', 'CONTROL');

-- CreateEnum
CREATE TYPE "HarveyActivityStatus" AS ENUM ('STARTED', 'SUCCEEDED', 'FAILED', 'SKIPPED', 'CANCELLED');

-- AlterEnum (valores novos não são usados nesta migration)
ALTER TYPE "OutreachStatus" ADD VALUE 'SENDING';
ALTER TYPE "OutreachStatus" ADD VALUE 'SEND_UNKNOWN';

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "campaign_id" TEXT;

-- AlterTable
ALTER TABLE "outreach_messages" ADD COLUMN     "send_claimed_at" TIMESTAMP(3),
ADD COLUMN     "send_error" TEXT,
ADD COLUMN     "send_initiator" TEXT,
ADD COLUMN     "send_request" JSONB;

-- AlterTable
ALTER TABLE "prospecting_targets" ADD COLUMN     "campaign_id" TEXT;

-- AlterTable
ALTER TABLE "scrape_jobs" ADD COLUMN     "campaign_id" TEXT,
ADD COLUMN     "harvey_run_id" TEXT,
ADD COLUMN     "prospecting_target_id" TEXT;

-- CreateTable
CREATE TABLE "sales_campaigns" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'ACTIVE',
    "country" TEXT NOT NULL,
    "region_label" TEXT,
    "language" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "working_days" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
    "work_start_minute" INTEGER NOT NULL DEFAULT 540,
    "work_end_minute" INTEGER NOT NULL DEFAULT 1080,
    "daily_research_goal" INTEGER NOT NULL DEFAULT 30,
    "daily_qualified_goal" INTEGER NOT NULL DEFAULT 15,
    "daily_outreach_goal" INTEGER NOT NULL DEFAULT 10,
    "enabled_channels" "OutreachChannel"[] DEFAULT ARRAY['EMAIL']::"OutreachChannel"[],
    "monthly_budget_usd" DECIMAL(10,2),
    "require_first_contact_approval" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "harvey_agents" (
    "organization_id" TEXT NOT NULL,
    "control_state" "HarveyControlState" NOT NULL DEFAULT 'STOPPED',
    "control_changed_at" TIMESTAMP(3),
    "control_changed_by_user_id" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "harvey_agents_pkey" PRIMARY KEY ("organization_id")
);

-- CreateTable
CREATE TABLE "harvey_runs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "cycle_date" DATE NOT NULL,
    "status" "HarveyRunStatus" NOT NULL DEFAULT 'RUNNING',
    "end_reason" TEXT,
    "goals" JSONB NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "paused_at" TIMESTAMP(3),
    "paused_ms" BIGINT NOT NULL DEFAULT 0,
    "last_error_at" TIMESTAMP(3),
    "last_error_message" TEXT,
    "last_success_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "harvey_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "harvey_activities" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "campaign_id" TEXT,
    "run_id" TEXT,
    "type" TEXT NOT NULL,
    "phase" "HarveyPhase" NOT NULL,
    "title" TEXT NOT NULL,
    "status" "HarveyActivityStatus" NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "lead_id" TEXT,
    "scrape_job_id" TEXT,
    "outreach_message_id" TEXT,
    "channel" "OutreachChannel",
    "result" JSONB,
    "rationale" JSONB,
    "error_message" TEXT,
    "queue_job_id" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "actor_type" "AuditActorType" NOT NULL,
    "actor_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "harvey_activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sales_campaigns_organization_id_status_idx" ON "sales_campaigns"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "sales_campaigns_organization_id_name_key" ON "sales_campaigns"("organization_id", "name");

-- CreateIndex
CREATE INDEX "harvey_runs_organization_id_status_idx" ON "harvey_runs"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "harvey_runs_campaign_id_cycle_date_key" ON "harvey_runs"("campaign_id", "cycle_date");

-- CreateIndex
CREATE INDEX "harvey_activities_organization_id_started_at_idx" ON "harvey_activities"("organization_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "harvey_activities_organization_id_lead_id_idx" ON "harvey_activities"("organization_id", "lead_id");

-- CreateIndex
CREATE INDEX "harvey_activities_run_id_type_status_idx" ON "harvey_activities"("run_id", "type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "harvey_activities_organization_id_idempotency_key_key" ON "harvey_activities"("organization_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "leads_organization_id_campaign_id_status_idx" ON "leads"("organization_id", "campaign_id", "status");

-- CreateIndex
CREATE INDEX "prospecting_targets_campaign_id_idx" ON "prospecting_targets"("campaign_id");

-- CreateIndex
CREATE INDEX "scrape_jobs_harvey_run_id_idx" ON "scrape_jobs"("harvey_run_id");

-- AddForeignKey
ALTER TABLE "scrape_jobs" ADD CONSTRAINT "scrape_jobs_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "sales_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scrape_jobs" ADD CONSTRAINT "scrape_jobs_prospecting_target_id_fkey" FOREIGN KEY ("prospecting_target_id") REFERENCES "prospecting_targets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scrape_jobs" ADD CONSTRAINT "scrape_jobs_harvey_run_id_fkey" FOREIGN KEY ("harvey_run_id") REFERENCES "harvey_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "sales_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospecting_targets" ADD CONSTRAINT "prospecting_targets_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "sales_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_campaigns" ADD CONSTRAINT "sales_campaigns_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "harvey_agents" ADD CONSTRAINT "harvey_agents_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "harvey_agents" ADD CONSTRAINT "harvey_agents_control_changed_by_user_id_fkey" FOREIGN KEY ("control_changed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "harvey_runs" ADD CONSTRAINT "harvey_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "harvey_runs" ADD CONSTRAINT "harvey_runs_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "sales_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "harvey_activities" ADD CONSTRAINT "harvey_activities_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "harvey_activities" ADD CONSTRAINT "harvey_activities_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "sales_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "harvey_activities" ADD CONSTRAINT "harvey_activities_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "harvey_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "harvey_activities" ADD CONSTRAINT "harvey_activities_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "harvey_activities" ADD CONSTRAINT "harvey_activities_scrape_job_id_fkey" FOREIGN KEY ("scrape_job_id") REFERENCES "scrape_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "harvey_activities" ADD CONSTRAINT "harvey_activities_outreach_message_id_fkey" FOREIGN KEY ("outreach_message_id") REFERENCES "outreach_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Horário de trabalho válido.
ALTER TABLE "sales_campaigns" ADD CONSTRAINT "sales_campaigns_work_window_check" CHECK ("work_end_minute" > "work_start_minute" AND "work_start_minute" >= 0 AND "work_end_minute" <= 1440);

-- Uma busca por alvo por ciclo, mesmo com várias réplicas do worker.
CREATE UNIQUE INDEX "scrape_jobs_harvey_run_id_prospecting_target_id_key" ON "scrape_jobs"("harvey_run_id", "prospecting_target_id") WHERE "harvey_run_id" IS NOT NULL AND "prospecting_target_id" IS NOT NULL AND "status" <> 'CANCELLED';

-- Atividades em andamento (estado "fazendo agora" e recuperação de órfãs).
CREATE INDEX "harvey_activities_in_progress_idx" ON "harvey_activities"("organization_id") WHERE "status" = 'STARTED';


-- Backfill: campanha padrão por organização, a partir da configuração atual.
INSERT INTO "sales_campaigns" ("id", "organization_id", "name", "country", "language", "timezone", "daily_research_goal", "updated_at")
SELECT gen_random_uuid()::text, o."id", 'Campanha padrão', c.country,
       CASE c.country WHEN 'US' THEN 'en-US' WHEN 'BR' THEN 'pt-BR' ELSE 'en-US' END,
       CASE c.country WHEN 'US' THEN 'America/New_York' WHEN 'BR' THEN 'America/Sao_Paulo' ELSE 'UTC' END,
       COALESCE(s."daily_research_limit", 30),
       CURRENT_TIMESTAMP
FROM "organizations" o
LEFT JOIN "organization_revenue_settings" s ON s."organization_id" = o."id"
CROSS JOIN LATERAL (SELECT COALESCE(s."default_outreach_country", 'US') AS country) c;

UPDATE "prospecting_targets" t SET "campaign_id" = c."id"
FROM "sales_campaigns" c WHERE c."organization_id" = t."organization_id";

UPDATE "leads" l SET "campaign_id" = c."id"
FROM "sales_campaigns" c WHERE c."organization_id" = l."organization_id" AND l."source_type" <> 'MANUAL';

ALTER TABLE "prospecting_targets" ALTER COLUMN "campaign_id" SET NOT NULL;

INSERT INTO "harvey_agents" ("organization_id", "updated_at")
SELECT "id", CURRENT_TIMESTAMP FROM "organizations";
