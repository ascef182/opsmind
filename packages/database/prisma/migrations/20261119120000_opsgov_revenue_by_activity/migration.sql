-- OpsGov Fase 2 — receita por atividade.
--
-- Decisões:
-- - Aditiva e sem backfill: financial_entries.company_activity_id nasce nulo
--   para todo lançamento existente. Classificar é decisão humana (tela de
--   classificação em lote), nunca inferida por categoria/descrição — um CNAE
--   errado no faturamento é exatamente o tipo de erro que aparece numa
--   fiscalização ou na habilitação de uma licitação.
-- - Aponta para a VERSÃO da atividade vigente na data de emissão (não só o
--   CNAE): o anexo do Simples e o grupo de receita podem mudar entre versões, e
--   o relatório histórico precisa refletir o que valia na época.
-- - ON DELETE SET NULL: atividades não são apagadas no fluxo normal (vigência
--   encerra, não apaga); se forem por script, o lançamento volta a "não
--   classificado" em vez de sumir.
-- - CHECK garante no banco que só receita da empresa é classificada: despesa e
--   lançamento PERSONAL nunca entram em faturamento/RBT12.
-- - A coerência de organização (atividade da mesma org do lançamento) fica no
--   service + RLS das duas tabelas; uma FK composta exigiria UNIQUE(id,
--   organization_id) fora do que o Prisma modela.


-- AlterTable
ALTER TABLE "financial_entries" ADD COLUMN     "company_activity_id" TEXT;

-- CreateIndex
CREATE INDEX "financial_entries_organization_id_company_activity_id_idx" ON "financial_entries"("organization_id", "company_activity_id");

-- AddForeignKey
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_company_activity_id_fkey" FOREIGN KEY ("company_activity_id") REFERENCES "company_activities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "financial_entries"
  ADD CONSTRAINT "financial_entries_activity_only_business_income_chk"
  CHECK ("company_activity_id" IS NULL OR ("direction" = 'INCOME' AND "scope" = 'BUSINESS'));
