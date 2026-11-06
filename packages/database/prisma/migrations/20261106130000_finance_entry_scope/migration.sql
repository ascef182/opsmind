-- Separa despesa/receita pessoal de empresa (CNPJ) dentro da mesma
-- organização. Default BUSINESS: todo lançamento/molde existente antes
-- deste campo continua sendo da empresa, sem mudança de comportamento.
--
-- Gerada com `prisma migrate diff --from-url ... --to-schema-datamodel
-- prisma/schema.prisma --script` e revisada à mão: o diff bruto também
-- propunha `DROP INDEX "document_chunks_embedding_hnsw_idx"` — ruído
-- conhecido (ver comentário em 20260827210000_documents_rag/migration.sql),
-- o índice HNSW de pgvector não é representável no schema.prisma, então o
-- Prisma acha que deveria dropá-lo. Removido deste arquivo de propósito.

-- CreateEnum
CREATE TYPE "FinancialScope" AS ENUM ('BUSINESS', 'PERSONAL');

-- AlterTable
ALTER TABLE "financial_entries" ADD COLUMN     "scope" "FinancialScope" NOT NULL DEFAULT 'BUSINESS';

-- AlterTable
ALTER TABLE "recurring_entries" ADD COLUMN     "scope" "FinancialScope" NOT NULL DEFAULT 'BUSINESS';

-- CreateIndex
CREATE INDEX "financial_entries_organization_id_scope_idx" ON "financial_entries"("organization_id", "scope");
