-- Despesas/receitas cotadas em moeda estrangeira (hoje: assinaturas em USD
-- como Railway/Resend), cujo valor real em reais varia mês a mês por câmbio
-- + IOF. `amount_cents` continua sendo o valor em reais de verdade (o que foi
-- cobrado/recebido) — estes campos novos são só o contexto de como se chegou
-- a ele, preenchido manualmente pelo usuário ao conferir e-mail/extrato.
-- Nenhuma cotação é buscada automaticamente por este sistema.

-- CreateEnum
CREATE TYPE "FinancialCurrency" AS ENUM ('USD');

-- AlterTable: molde — valor nominal de referência, herdado por cada
-- lançamento gerado; não guarda cotação/IOF (isso varia por mês, não no molde).
ALTER TABLE "recurring_entries"
  ADD COLUMN "foreign_currency" "FinancialCurrency",
  ADD COLUMN "foreign_amount_cents" INTEGER;

ALTER TABLE "recurring_entries" ADD CONSTRAINT "recurring_entries_foreign_pair_check"
  CHECK (("foreign_currency" IS NULL) = ("foreign_amount_cents" IS NULL));
ALTER TABLE "recurring_entries" ADD CONSTRAINT "recurring_entries_foreign_amount_positive_check"
  CHECK ("foreign_amount_cents" IS NULL OR "foreign_amount_cents" > 0);

-- AlterTable: lançamento — valor nominal (herdado do molde ou avulso) + a
-- reconciliação real do mês (cotação, IOF), preenchida à parte.
ALTER TABLE "financial_entries"
  ADD COLUMN "foreign_currency" "FinancialCurrency",
  ADD COLUMN "foreign_amount_cents" INTEGER,
  ADD COLUMN "exchange_rate" DECIMAL(10,4),
  ADD COLUMN "iof_cents" INTEGER;

ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_foreign_pair_check"
  CHECK (("foreign_currency" IS NULL) = ("foreign_amount_cents" IS NULL));
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_foreign_amount_positive_check"
  CHECK ("foreign_amount_cents" IS NULL OR "foreign_amount_cents" > 0);
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_exchange_rate_positive_check"
  CHECK ("exchange_rate" IS NULL OR "exchange_rate" > 0);
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_iof_cents_range_check"
  CHECK ("iof_cents" IS NULL OR ("iof_cents" >= 0 AND "iof_cents" <= "amount_cents"));
-- Cotação/IOF só fazem sentido se já há uma moeda estrangeira registrada.
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_foreign_context_check"
  CHECK (
    ("exchange_rate" IS NULL AND "iof_cents" IS NULL)
    OR "foreign_currency" IS NOT NULL
  );
