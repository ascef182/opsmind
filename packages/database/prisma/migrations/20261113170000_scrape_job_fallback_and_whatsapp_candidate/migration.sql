-- Dois campos independentes, numa migration só porque ambos saíram do mesmo
-- plano de trabalho (ver apps/worker/src/lead-scrape-processor.ts):
--
-- 1. `scrape_jobs.fallback_of_scrape_job_id`: marca um ScrapeJob Camofox
--    criado AUTOMATICAMENTE como fallback de um ScrapeJob Apify que não
--    cobriu a região/tipo de negócio — idempotência (nunca criar 2
--    fallbacks pro mesmo job origem) e nunca encadear fallback-de-fallback.
--
-- 2. `leads.is_whatsapp_candidate`: sinal de PRIORIZAÇÃO (não confirmado)
--    para leads com telefone estruturado + ausência de site confirmada —
--    diferente de `leads.whatsapp`, que só é preenchido por descoberta real.
--
-- O diff bruto (`prisma migrate diff`) também propôs
-- `DROP INDEX "document_chunks_embedding_hnsw_idx"` — mesma observação já
-- registrada em `20261106160200_lead_signals_signal_code_fk/migration.sql`:
-- o shadow database do Prisma não tem a extensão `pgvector` habilitada
-- (só o banco real recebe `01-extensions.sql`), então o diff não reconhece
-- o índice HNSW existente e tenta recriá-lo à toa. Removida do script final.

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "is_whatsapp_candidate" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "scrape_jobs" ADD COLUMN     "fallback_of_scrape_job_id" TEXT;

-- CreateIndex
CREATE INDEX "scrape_jobs_fallback_of_scrape_job_id_idx" ON "scrape_jobs"("fallback_of_scrape_job_id");

-- AddForeignKey
ALTER TABLE "scrape_jobs" ADD CONSTRAINT "scrape_jobs_fallback_of_scrape_job_id_fkey" FOREIGN KEY ("fallback_of_scrape_job_id") REFERENCES "scrape_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
