-- OpsGov Fase 5 — espaço do contador.
--
-- Decisões:
-- - accounting_proposals: uma linha por proposta de escritório, com o cenário
--   (A = transformar o CNPJ do MEI, B = CNPJ novo) e custos em centavos
--   separados em inicial, mensal e anual — o comparativo (função pura
--   accountingCostComparison) soma isso aos tributos estimados do simulador.
-- - accounting_decisions.answers é uma lista append-only (JSONB) de
--   { text, author, at }: perguntas e respostas trocadas com o contador nunca
--   são editadas, só acrescentadas. Reabrir uma decisão registra a decisão
--   anterior como resposta antes de limpá-la.
-- - seed_key + UNIQUE(organization_id, seed_key) torna idempotente o
--   carregamento das decisões padrão (DEFAULT_ACCOUNTING_DECISIONS), tanto pelo
--   seed quanto pelo botão da tela. NULLs não colidem: decisões criadas à mão
--   não têm chave.
-- - DECIDIDO exige decisão final e data (CHECK).
-- - RLS em 20261119170100_opsgov_accounting_rls.

-- CreateEnum
CREATE TYPE "AccountingScenario" AS ENUM ('A_TRANSFORMAR', 'B_NOVO_CNPJ');

-- CreateEnum
CREATE TYPE "AccountingDecisionStatus" AS ENUM ('PENDENTE', 'EM_ANALISE', 'DECIDIDO');

-- CreateTable
CREATE TABLE "accounting_proposals" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "firm" TEXT NOT NULL,
    "contact_name" TEXT,
    "scenario" "AccountingScenario" NOT NULL,
    "setup_cents" INTEGER NOT NULL,
    "monthly_fee_cents" INTEGER NOT NULL,
    "annual_cents" INTEGER NOT NULL DEFAULT 0,
    "includes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "document_id" TEXT,
    "actor_type" "AuditActorType" NOT NULL,
    "actor_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounting_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_decisions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "seed_key" TEXT,
    "topic" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answers" JSONB NOT NULL DEFAULT '[]',
    "final_decision" TEXT,
    "decided_at" TIMESTAMP(3),
    "status" "AccountingDecisionStatus" NOT NULL DEFAULT 'PENDENTE',
    "actor_type" "AuditActorType" NOT NULL,
    "actor_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounting_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "accounting_proposals_organization_id_idx" ON "accounting_proposals"("organization_id");

-- CreateIndex
CREATE INDEX "accounting_decisions_organization_id_status_idx" ON "accounting_decisions"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_decisions_organization_id_seed_key_key" ON "accounting_decisions"("organization_id", "seed_key");

-- AddForeignKey
ALTER TABLE "accounting_proposals" ADD CONSTRAINT "accounting_proposals_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_proposals" ADD CONSTRAINT "accounting_proposals_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_decisions" ADD CONSTRAINT "accounting_decisions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "accounting_proposals"
  ADD CONSTRAINT "accounting_proposals_costs_chk" CHECK ("setup_cents" >= 0 AND "monthly_fee_cents" >= 0 AND "annual_cents" >= 0);

ALTER TABLE "accounting_decisions"
  ADD CONSTRAINT "accounting_decisions_decided_chk" CHECK (
    "status" <> 'DECIDIDO' OR ("final_decision" IS NOT NULL AND "decided_at" IS NOT NULL)
  ),
  ADD CONSTRAINT "accounting_decisions_answers_array_chk" CHECK (jsonb_typeof("answers") = 'array');
