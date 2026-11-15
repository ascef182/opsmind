-- Leads & Prospecting — schema (Tarefa 1 do plano leads-prospecting-dashboard).
--
-- Escrita à mão (não gerada por `prisma migrate dev`, que recusa rodar aqui:
-- o shadow database criado pelo schema-engine não tem a extensão `vector`
-- instalada, e falha ao tentar reaplicar 20260827210000_documents_rag nele —
-- mesmo fallback já documentado nessa migration para `prisma migrate dev`
-- não rodar de forma utilizável neste ambiente). Gerada a partir do diff
-- manual entre o schema anterior e o novo, aplicada com `prisma migrate
-- deploy` e registrada em `_prisma_migrations` por esse mesmo comando.
--
-- ATENÇÃO — limpeza de contaminação cross-worktree: o Postgres local
-- (infra/docker/docker-compose.yml) é compartilhado entre todos os git
-- worktrees deste checkout. O worktree `feat/prospecting-outbound` (branch
-- irmã, focada em prospecção via Reddit, NÃO relacionada ao trabalho desta
-- branch) já tinha aplicado suas próprias migrations contra este MESMO
-- banco físico, criando tabelas/enums com os MESMOS NOMES que esta feature
-- precisa (leads, service_offerings, scrape_jobs, lead_enrichments,
-- outreach_messages, ScrapeSourceType, ScrapeJobStatus, LeadStatus,
-- OutreachChannel, OutreachStatus) mas com colunas/valores diferentes e
-- incompatíveis com o schema.prisma desta branch (ex.: ScrapeSourceType lá
-- tinha REDDIT_SEARCH/WEB_SEARCH/WEBSITE_SNAPSHOT; aqui são
-- APIFY_GOOGLE_MAPS/EXPLORIUM_BUSINESS_SEARCH/CAMOFOX_*). Esses objetos não
-- fazem parte do histórico de migrations desta pasta (não há nenhuma
-- migration "prospecting" aqui) — são estado local descartável daquele
-- outro worktree, sempre regenerável rodando as migrations dele de novo.
-- Em vez de DROPar esses objetos (perderia os dados daquele outro projeto
-- sem necessidade), eles são movidos para um schema Postgres separado
-- (`orphan_prospecting_outbound`) via `SET SCHEMA` — libera os nomes em
-- `public` para as tabelas/enums desta feature, sem perda de dados,
-- reversível a qualquer momento (`SET SCHEMA public` de volta), e sem exigir
-- renomear cada índice/constraint individualmente (eles migram junto com a
-- tabela, e o namespace de nomes de índice é por schema, não global).
--
-- GUARDADO com existence checks (`DO $$ ... END $$` + `IF EXISTS (SELECT ...
-- FROM pg_tables/pg_type) THEN ALTER ... END IF`): Postgres não tem um
-- `ALTER TABLE IF EXISTS ... SET SCHEMA` de curto-circuito nativo, e sem essa
-- guarda o bloco quebra com "relation/type does not exist" em QUALQUER banco
-- que nunca teve essa contaminação — que é o caso de todo banco exceto esta
-- única máquina local (CI roda `prisma migrate deploy` contra um Postgres
-- recém-criado; o mesmo vale para o clone de qualquer outro dev, staging e
-- produção). Com a guarda, este bloco inteiro é (e deve continuar sendo) um
-- no-op permanente e inofensivo em todo ambiente daqui pra frente, exceto
-- neste Postgres local específico onde a colisão foi encontrada em
-- 2026-09-02. Vale manter esse no-op no histórico (em vez de resolver com um
-- `psql` manual fora da migration) porque é exatamente isso que faz esta
-- migration continuar aplicável de forma limpa via `prisma migrate deploy`
-- neste worktree local sempre que o volume Docker for recriado do zero — sem
-- depender de mais um passo manual documentado à parte.

CREATE SCHEMA IF NOT EXISTS "orphan_prospecting_outbound";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'outreach_messages') THEN
    ALTER TABLE "outreach_messages" SET SCHEMA "orphan_prospecting_outbound";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'lead_enrichments') THEN
    ALTER TABLE "lead_enrichments" SET SCHEMA "orphan_prospecting_outbound";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'leads') THEN
    ALTER TABLE "leads" SET SCHEMA "orphan_prospecting_outbound";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'scrape_jobs') THEN
    ALTER TABLE "scrape_jobs" SET SCHEMA "orphan_prospecting_outbound";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'service_offerings') THEN
    ALTER TABLE "service_offerings" SET SCHEMA "orphan_prospecting_outbound";
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'OutreachStatus'
  ) THEN
    ALTER TYPE "OutreachStatus" SET SCHEMA "orphan_prospecting_outbound";
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'OutreachChannel'
  ) THEN
    ALTER TYPE "OutreachChannel" SET SCHEMA "orphan_prospecting_outbound";
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'LeadStatus'
  ) THEN
    ALTER TYPE "LeadStatus" SET SCHEMA "orphan_prospecting_outbound";
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'ScrapeJobStatus'
  ) THEN
    ALTER TYPE "ScrapeJobStatus" SET SCHEMA "orphan_prospecting_outbound";
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'ScrapeSourceType'
  ) THEN
    ALTER TYPE "ScrapeSourceType" SET SCHEMA "orphan_prospecting_outbound";
  END IF;
END $$;

-- CreateEnum
CREATE TYPE "ScrapeSourceType" AS ENUM ('APIFY_GOOGLE_MAPS', 'EXPLORIUM_BUSINESS_SEARCH', 'CAMOFOX_GOOGLE_SEARCH', 'CAMOFOX_REDDIT_SEARCH', 'MANUAL');

-- CreateEnum
CREATE TYPE "ScrapeJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('DISCOVERED', 'QUALIFIED', 'DISQUALIFIED', 'OUTREACH_DRAFTED', 'OUTREACH_APPROVED', 'CONTACTED', 'REPLIED', 'CONVERTED', 'LOST');

-- CreateEnum
CREATE TYPE "OutreachChannel" AS ENUM ('EMAIL', 'PHONE', 'WHATSAPP', 'LINKEDIN_DM', 'REDDIT_DM', 'OTHER');

-- CreateEnum
CREATE TYPE "OutreachStatus" AS ENUM ('DRAFT', 'APPROVED', 'REJECTED', 'SENT', 'REPLIED');

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN "scraping_monthly_budget" DECIMAL(10,2);

-- CreateTable
CREATE TABLE "service_offerings" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "signals" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "target_industries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "min_employees" INTEGER,
    "max_employees" INTEGER,
    "min_revenue_usd" INTEGER,
    "max_revenue_usd" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_offerings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scrape_jobs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "source_type" "ScrapeSourceType" NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "business_type" TEXT NOT NULL,
    "only_without_website" BOOLEAN NOT NULL DEFAULT true,
    "limit" INTEGER NOT NULL DEFAULT 50,
    "status" "ScrapeJobStatus" NOT NULL DEFAULT 'QUEUED',
    "leads_found" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "actor_type" "AuditActorType" NOT NULL,
    "actor_id" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scrape_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "scrape_job_id" TEXT,
    "source_type" "ScrapeSourceType" NOT NULL DEFAULT 'MANUAL',
    "name" TEXT NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "google_category" TEXT,
    "rating" DECIMAL(2,1),
    "review_count" INTEGER,
    "place_id" TEXT,
    "raw_content" TEXT,
    "raw_snapshot" JSONB,
    "status" "LeadStatus" NOT NULL DEFAULT 'DISCOVERED',
    "score" INTEGER,
    "score_breakdown" JSONB,
    "suggested_offering_id" TEXT,
    "converted_customer_id" TEXT,
    "actor_type" "AuditActorType" NOT NULL,
    "actor_id" TEXT,
    "discovered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_enrichments" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "source_url" TEXT,
    "actor_type" "AuditActorType" NOT NULL,
    "actor_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_enrichments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outreach_messages" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "service_offering_id" TEXT,
    "channel" "OutreachChannel" NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "evidence_quotes" JSONB NOT NULL,
    "status" "OutreachStatus" NOT NULL DEFAULT 'DRAFT',
    "generated_by_model" TEXT,
    "ai_request_id" TEXT,
    "approved_by_user_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "rejected_reason" TEXT,
    "sent_at" TIMESTAMP(3),
    "replied_at" TIMESTAMP(3),
    "actor_type" "AuditActorType" NOT NULL,
    "actor_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outreach_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "service_offerings_organization_id_idx" ON "service_offerings"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_offerings_organization_id_name_key" ON "service_offerings"("organization_id", "name");

-- CreateIndex
CREATE INDEX "scrape_jobs_organization_id_status_idx" ON "scrape_jobs"("organization_id", "status");

-- CreateIndex
CREATE INDEX "scrape_jobs_organization_id_created_at_idx" ON "scrape_jobs"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "leads_organization_id_status_idx" ON "leads"("organization_id", "status");

-- CreateIndex
CREATE INDEX "leads_organization_id_city_state_idx" ON "leads"("organization_id", "city", "state");

-- CreateIndex
CREATE INDEX "leads_organization_id_discovered_at_idx" ON "leads"("organization_id", "discovered_at");

-- CreateIndex
CREATE INDEX "leads_scrape_job_id_idx" ON "leads"("scrape_job_id");

-- CreateIndex
CREATE INDEX "leads_converted_customer_id_idx" ON "leads"("converted_customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "leads_organization_id_place_id_key" ON "leads"("organization_id", "place_id");

-- CreateIndex
CREATE INDEX "lead_enrichments_organization_id_lead_id_idx" ON "lead_enrichments"("organization_id", "lead_id");

-- CreateIndex
CREATE INDEX "outreach_messages_organization_id_status_idx" ON "outreach_messages"("organization_id", "status");

-- CreateIndex
CREATE INDEX "outreach_messages_lead_id_idx" ON "outreach_messages"("lead_id");

-- AddForeignKey
ALTER TABLE "service_offerings" ADD CONSTRAINT "service_offerings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scrape_jobs" ADD CONSTRAINT "scrape_jobs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_scrape_job_id_fkey" FOREIGN KEY ("scrape_job_id") REFERENCES "scrape_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_suggested_offering_id_fkey" FOREIGN KEY ("suggested_offering_id") REFERENCES "service_offerings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_converted_customer_id_fkey" FOREIGN KEY ("converted_customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_enrichments" ADD CONSTRAINT "lead_enrichments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_enrichments" ADD CONSTRAINT "lead_enrichments_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_messages" ADD CONSTRAINT "outreach_messages_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_messages" ADD CONSTRAINT "outreach_messages_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_messages" ADD CONSTRAINT "outreach_messages_service_offering_id_fkey" FOREIGN KEY ("service_offering_id") REFERENCES "service_offerings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_messages" ADD CONSTRAINT "outreach_messages_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
