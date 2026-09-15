-- Deal — pipeline de negociação pós-conversão (plano
-- pensando-como-empresa-com-agile-beaver.md). Escrita à mão (não gerada por
-- `prisma migrate dev`, que recusa rodar neste ambiente pelo mesmo motivo já
-- documentado em 20260902120000_leads_prospecting: o shadow database do
-- schema-engine não tem a extensão `vector` instalada e falha ao reaplicar
-- 20260827210000_documents_rag nele). Gerada a partir do diff manual entre o
-- schema anterior e o novo, aplicada com `prisma migrate deploy`.
--
-- Soft-delete (`deleted_at`, como Customer) em vez do padrão de Lead: um Deal
-- é registro financeiro/de negociação, nunca apagado de fato.
-- `origin_lead_id` é a ponte "achar -> fechar" com o pipeline de prospecção
-- já existente (Lead.status CONVERTED) — nullable porque um Deal também pode
-- ser criado manualmente para um Customer que já existia antes desta feature.

-- CreateEnum
CREATE TYPE "DealStage" AS ENUM ('QUALIFICATION', 'PROPOSAL', 'NEGOTIATION', 'CONTRACT_SENT', 'WON', 'LOST');

-- CreateTable
CREATE TABLE "deals" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "origin_lead_id" TEXT,
    "title" TEXT NOT NULL,
    "stage" "DealStage" NOT NULL DEFAULT 'QUALIFICATION',
    "value" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "expected_close_date" TIMESTAMP(3),
    "actual_close_date" TIMESTAMP(3),
    "owner_user_id" TEXT,
    "lost_reason" TEXT,
    "actor_type" "AuditActorType" NOT NULL,
    "actor_id" TEXT,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "deals_organization_id_stage_idx" ON "deals"("organization_id", "stage");

-- CreateIndex
CREATE INDEX "deals_organization_id_customer_id_idx" ON "deals"("organization_id", "customer_id");

-- CreateIndex
CREATE INDEX "deals_organization_id_expected_close_date_idx" ON "deals"("organization_id", "expected_close_date");

-- CreateIndex
CREATE INDEX "deals_owner_user_id_idx" ON "deals"("owner_user_id");

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_origin_lead_id_fkey" FOREIGN KEY ("origin_lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
