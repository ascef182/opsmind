-- Módulo financeiro (Contract -> FinancialEntry -> FinancialPayment, mais o
-- molde RecurringEntry). Escrita à mão, como as migrations de deals/leads,
-- pelo mesmo motivo (o shadow database do `prisma migrate dev` não tem a
-- extensão `vector`) — aplicar com `prisma migrate deploy`.
--
-- DECISÕES (espelham o bloco "Financeiro" do schema.prisma):
--
--  * Dinheiro em centavos inteiros (`*_cents` INTEGER). Nada de NUMERIC/FLOAT:
--    soma exata e JSON sem surpresa. Teto de ~R$ 21,4 mi por lançamento.
--  * Nada é apagado: lançamento é cancelado, pagamento é estornado. Por isso
--    as FKs para `customers` são RESTRICT (Customer já é soft-delete) e o
--    CASCADE só dispara se a ORGANIZAÇÃO inteira for removida.
--  * Contratado != faturado != recebido: contracts / financial_entries /
--    financial_payments são três tabelas, nunca três colunas da mesma.
--  * "Atrasado" é derivado (due_date < hoje e não quitado), jamais gravado.
--  * Datas de negócio são DATE (dia do calendário), não TIMESTAMP.
--
-- CHECKs que o Prisma não expressa, mas que impedem dado impossível mesmo se
-- um bug de aplicação passar pelas validações do service:
--   * valores positivos, taxas <= valor, pago <= valor;
--   * status coerente com o pago (PAID => pago == valor; PARTIAL => 0 < pago <
--     valor; PLANNED/PENDING/CANCELLED => pago == 0);
--   * dia do mês entre 1 e 31; mês no formato 'YYYY-MM'.

-- CreateEnum
CREATE TYPE "FinancialDirection" AS ENUM ('INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "FinancialCategory" AS ENUM ('IMPLEMENTATION', 'PROJECT', 'DEVELOPMENT', 'CONSULTING', 'MONTHLY_FEE', 'SAAS', 'RECURRING_CONTRACT', 'ADDITIONAL_SERVICE', 'OTHER_INCOME', 'INFRASTRUCTURE', 'DOMAINS', 'APIS', 'AI', 'WHATSAPP', 'TOOLS', 'MARKETING', 'TAXES', 'SUPPLIERS', 'OPERATIONAL', 'OTHER_EXPENSE');

-- CreateEnum
CREATE TYPE "FinancialEntryStatus" AS ENUM ('PLANNED', 'PENDING', 'PARTIAL', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ContractBilling" AS ENUM ('ONE_TIME', 'MONTHLY');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "contracts" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "deal_id" TEXT,
    "title" TEXT NOT NULL,
    "category" "FinancialCategory" NOT NULL,
    "billing" "ContractBilling" NOT NULL,
    "value_cents" INTEGER NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "billing_day" INTEGER,
    "status" "ContractStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "actor_type" "AuditActorType" NOT NULL,
    "actor_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "contracts_value_positive" CHECK ("value_cents" > 0),
    CONSTRAINT "contracts_billing_day_range" CHECK ("billing_day" IS NULL OR ("billing_day" BETWEEN 1 AND 31)),
    CONSTRAINT "contracts_monthly_has_billing_day" CHECK ("billing" <> 'MONTHLY' OR "billing_day" IS NOT NULL),
    CONSTRAINT "contracts_dates_ordered" CHECK ("end_date" IS NULL OR "end_date" >= "start_date")
);

-- CreateTable
CREATE TABLE "recurring_entries" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "direction" "FinancialDirection" NOT NULL,
    "category" "FinancialCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "supplier_name" TEXT,
    "amount_cents" INTEGER NOT NULL,
    "fees_cents" INTEGER NOT NULL DEFAULT 0,
    "day_of_month" INTEGER NOT NULL,
    "start_month" TEXT NOT NULL,
    "end_month" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "customer_id" TEXT,
    "contract_id" TEXT,
    "actor_type" "AuditActorType" NOT NULL,
    "actor_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recurring_entries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "recurring_entries_amount_positive" CHECK ("amount_cents" > 0),
    CONSTRAINT "recurring_entries_fees_range" CHECK ("fees_cents" >= 0 AND "fees_cents" <= "amount_cents"),
    CONSTRAINT "recurring_entries_day_range" CHECK ("day_of_month" BETWEEN 1 AND 31),
    CONSTRAINT "recurring_entries_start_month_format" CHECK ("start_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
    CONSTRAINT "recurring_entries_end_month_format" CHECK ("end_month" IS NULL OR ("end_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' AND "end_month" >= "start_month"))
);

-- CreateTable
CREATE TABLE "financial_entries" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "direction" "FinancialDirection" NOT NULL,
    "category" "FinancialCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "supplier_name" TEXT,
    "customer_id" TEXT,
    "contract_id" TEXT,
    "recurring_entry_id" TEXT,
    "reference_month" TEXT,
    "amount_cents" INTEGER NOT NULL,
    "fees_cents" INTEGER NOT NULL DEFAULT 0,
    "paid_cents" INTEGER NOT NULL DEFAULT 0,
    "status" "FinancialEntryStatus" NOT NULL DEFAULT 'PENDING',
    "issue_date" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "settled_at" DATE,
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "notes" TEXT,
    "actor_type" "AuditActorType" NOT NULL,
    "actor_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_entries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "financial_entries_amount_positive" CHECK ("amount_cents" > 0),
    CONSTRAINT "financial_entries_fees_range" CHECK ("fees_cents" >= 0 AND "fees_cents" <= "amount_cents"),
    CONSTRAINT "financial_entries_paid_range" CHECK ("paid_cents" >= 0 AND "paid_cents" <= "amount_cents"),
    CONSTRAINT "financial_entries_reference_month_format" CHECK ("reference_month" IS NULL OR "reference_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
    CONSTRAINT "financial_entries_status_matches_paid" CHECK (
        ("status" = 'PAID' AND "paid_cents" = "amount_cents")
        OR ("status" = 'PARTIAL' AND "paid_cents" > 0 AND "paid_cents" < "amount_cents")
        OR ("status" IN ('PLANNED', 'PENDING', 'CANCELLED') AND "paid_cents" = 0)
    ),
    CONSTRAINT "financial_entries_settled_iff_paid" CHECK (("status" = 'PAID') = ("settled_at" IS NOT NULL))
);

-- CreateTable
CREATE TABLE "financial_payments" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "entry_id" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "paid_at" DATE NOT NULL,
    "method" TEXT,
    "note" TEXT,
    "reversed_at" TIMESTAMP(3),
    "reverse_reason" TEXT,
    "actor_type" "AuditActorType" NOT NULL,
    "actor_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_payments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "financial_payments_amount_positive" CHECK ("amount_cents" > 0)
);

-- CreateIndex
CREATE INDEX "contracts_organization_id_status_idx" ON "contracts"("organization_id", "status");

-- CreateIndex
CREATE INDEX "contracts_organization_id_customer_id_idx" ON "contracts"("organization_id", "customer_id");

-- CreateIndex
CREATE INDEX "contracts_deal_id_idx" ON "contracts"("deal_id");

-- CreateIndex
CREATE INDEX "recurring_entries_organization_id_active_idx" ON "recurring_entries"("organization_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "financial_entries_recurring_entry_id_reference_month_key" ON "financial_entries"("recurring_entry_id", "reference_month");

-- CreateIndex
CREATE INDEX "financial_entries_organization_id_direction_status_idx" ON "financial_entries"("organization_id", "direction", "status");

-- CreateIndex
CREATE INDEX "financial_entries_organization_id_due_date_idx" ON "financial_entries"("organization_id", "due_date");

-- CreateIndex
CREATE INDEX "financial_entries_organization_id_customer_id_idx" ON "financial_entries"("organization_id", "customer_id");

-- CreateIndex
CREATE INDEX "financial_entries_organization_id_contract_id_idx" ON "financial_entries"("organization_id", "contract_id");

-- CreateIndex
CREATE INDEX "financial_payments_organization_id_paid_at_idx" ON "financial_payments"("organization_id", "paid_at");

-- CreateIndex
CREATE INDEX "financial_payments_entry_id_idx" ON "financial_payments"("entry_id");

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_entries" ADD CONSTRAINT "recurring_entries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_entries" ADD CONSTRAINT "recurring_entries_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_entries" ADD CONSTRAINT "recurring_entries_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_recurring_entry_id_fkey" FOREIGN KEY ("recurring_entry_id") REFERENCES "recurring_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_payments" ADD CONSTRAINT "financial_payments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_payments" ADD CONSTRAINT "financial_payments_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "financial_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
