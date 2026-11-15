-- Dois campos independentes, numa migration só porque ambos saíram do mesmo
-- plano de trabalho (radar de risco do funil ativo, 2026-11-14):
--
-- 1. `deals.stage_entered_at`: timestamp de quando o Deal entrou na etapa
--    atual (nunca a criação do Deal) — alimenta o radar de risco (dias
--    parado numa etapa) e o trigger `DEAL_STAGE_STALE` (task 3). Backfill
--    com `created_at` para linhas existentes, já que não há como saber
--    retroativamente quando cada Deal entrou na etapa em que já está.
--
-- 2. `automation_runs.deal_id`: análogo a `automation_runs.customer_id`
--    (dedup indexado), mas para os dois triggers novos de Deal
--    (`DEAL_STAGE_STALE`/`DEAL_SILENT_FOR`), que fazem dedup por Deal em
--    vez de por Customer.
--
-- O diff bruto (`prisma migrate diff`) também propôs
-- `DROP INDEX "document_chunks_embedding_hnsw_idx"` — mesma observação já
-- registrada em migrations anteriores (ex.: `20261113170000_...`): o
-- shadow database do Prisma não tem a extensão `pgvector` habilitada, então
-- o diff não reconhece o índice HNSW existente e tenta recriá-lo à toa.
-- Removida do script final.

-- AlterTable
ALTER TABLE "deals" ADD COLUMN "stage_entered_at" TIMESTAMP(3);
UPDATE "deals" SET "stage_entered_at" = "created_at" WHERE "stage_entered_at" IS NULL;
ALTER TABLE "deals" ALTER COLUMN "stage_entered_at" SET NOT NULL;
ALTER TABLE "deals" ALTER COLUMN "stage_entered_at" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "automation_runs" ADD COLUMN "deal_id" TEXT;

-- CreateIndex
CREATE INDEX "automation_runs_automation_id_deal_id_status_idx" ON "automation_runs"("automation_id", "deal_id", "status");

-- AddForeignKey
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;
