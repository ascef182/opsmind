-- Sinais estruturados de investigação de lead (LeadSignal) e vocabulário
-- governado (SignalCode) — ver docs/planning/2026-11-06-harvey-inteligencia-comercial.md.
--
-- Gerada via `prisma migrate diff --from-url ... --to-schema-datamodel ...`
-- em vez de `prisma migrate dev` porque o shadow database do Prisma falha ao
-- reaplicar a migration `20260827210000_documents_rag` (tipo `vector` não
-- existe na shadow DB, que não roda `infra/docker/init/01-extensions.sql`) —
-- mesmo problema já documentado em CLAUDE.md para outras migrations deste
-- projeto. O diff bruto também propôs um `DROP INDEX
-- document_chunks_embedding_hnsw_idx` (índice HNSW em pgvector, não
-- representável em schema.prisma como `Unsupported("vector(1536)")`) — essa
-- linha foi removida manualmente abaixo: não faz parte desta mudança e
-- dropar esse índice seria destrutivo e fora do escopo desta feature.

-- CreateEnum
CREATE TYPE "LeadSignalCollector" AS ENUM ('WEBSITE_PROFILER', 'AI_ANALYSIS', 'MANUAL');

-- CreateEnum
CREATE TYPE "SignalCodeStatus" AS ENUM ('PROPOSED', 'CONFIRMED', 'DEPRECATED');

-- CreateTable
CREATE TABLE "lead_signals" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "signal_code" TEXT NOT NULL,
    "value" TEXT,
    "confidence" DECIMAL(3,2) NOT NULL,
    "collector" "LeadSignalCollector" NOT NULL,
    "evidence_url" TEXT,
    "evidence_quote" TEXT,
    "collection_basis" TEXT NOT NULL DEFAULT 'dado_publico',
    "run_id" TEXT NOT NULL,
    "observed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "market_opportunity_id" TEXT,

    CONSTRAINT "lead_signals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signal_codes" (
    "code" TEXT NOT NULL,
    "organization_id" TEXT,
    "label" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "default_service_offering_id" TEXT,
    "status" "SignalCodeStatus" NOT NULL DEFAULT 'PROPOSED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signal_codes_pkey" PRIMARY KEY ("code")
);

-- CreateIndex
CREATE INDEX "lead_signals_organization_id_lead_id_idx" ON "lead_signals"("organization_id", "lead_id");

-- CreateIndex
CREATE INDEX "lead_signals_organization_id_signal_code_idx" ON "lead_signals"("organization_id", "signal_code");

-- CreateIndex
CREATE UNIQUE INDEX "lead_signals_lead_id_signal_code_run_id_key" ON "lead_signals"("lead_id", "signal_code", "run_id");

-- CreateIndex
CREATE INDEX "signal_codes_organization_id_idx" ON "signal_codes"("organization_id");

-- AddForeignKey
ALTER TABLE "lead_signals" ADD CONSTRAINT "lead_signals_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_signals" ADD CONSTRAINT "lead_signals_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_signals" ADD CONSTRAINT "lead_signals_market_opportunity_id_fkey" FOREIGN KEY ("market_opportunity_id") REFERENCES "market_opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signal_codes" ADD CONSTRAINT "signal_codes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signal_codes" ADD CONSTRAINT "signal_codes_default_service_offering_id_fkey" FOREIGN KEY ("default_service_offering_id") REFERENCES "service_offerings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed do vocabulário global inicial (organization_id NULL = visível para
-- toda organização, ver política de RLS na migration seguinte). Cobre os
-- sinais que o profiler de site (Fase 1) já sabe detectar — mais códigos
-- entram por `propose_signal_code` (Fase 5) sem precisar de nova migration.
INSERT INTO "signal_codes" ("code", "organization_id", "label", "category", "status") VALUES
    ('website.no_ssl', NULL, 'Site sem HTTPS', 'website', 'CONFIRMED'),
    ('website.no_contact_form', NULL, 'Sem formulário de contato', 'website', 'CONFIRMED'),
    ('website.outdated_copyright_year', NULL, 'Ano de copyright desatualizado', 'website', 'CONFIRMED'),
    ('website.no_mobile_viewport', NULL, 'Sem viewport mobile configurado', 'website', 'CONFIRMED'),
    ('social.no_instagram', NULL, 'Sem perfil de Instagram encontrado', 'social', 'CONFIRMED'),
    ('social.no_whatsapp_link', NULL, 'Sem link de WhatsApp no site', 'social', 'CONFIRMED');
