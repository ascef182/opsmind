-- OpsGov Fase 4 — calendário de obrigações e certidões.
--
-- Decisões:
-- - compliance_obligations guarda a regra (recorrência mensal/anual/única,
--   dia e mês) e o PRÓXIMO vencimento. Cumprir não apaga nada: grava uma linha
--   em compliance_obligation_completions (o que foi feito, quando, por quem,
--   comprovante) e avança next_due_date pela regra pura nextDueDate. UNIQUE
--   (obligation_id, due_date) impede cumprir o mesmo vencimento duas vezes.
-- - certificates NÃO tem coluna de status: VALIDA/VENCENDO/VENCIDA depende de
--   "hoje" e é calculado (certificateStatus, shared-types). Renovar = nova
--   linha do mesmo tipo; a mais recente (maior valid_until) é a que vale.
-- - compliance_reminders é o log de idempotência do scan do worker: UNIQUE
--   (subject_type, subject_id, due_date, offset_days). O worker insere o
--   lembrete e as notificações na mesma transação; conflito = já notificado.
--   due_date entra na chave: obrigação recorrente notifica de novo a cada
--   vencimento, certidão renovada também.
-- - document_id ON DELETE SET NULL, como nas tabelas da Fase 1.
-- - RLS em 20261119150100_opsgov_compliance_rls.

-- CreateEnum
CREATE TYPE "ComplianceObligationType" AS ENUM ('DAS', 'DASN_SIMEI', 'DEFIS', 'TAXA_MUNICIPAL', 'CERTIFICADO_DIGITAL', 'OUTRA');

-- CreateEnum
CREATE TYPE "ObligationRecurrence" AS ENUM ('MONTHLY', 'YEARLY', 'ONCE');

-- CreateEnum
CREATE TYPE "ObligationStatus" AS ENUM ('PENDENTE', 'CUMPRIDA', 'DISPENSADA');

-- CreateEnum
CREATE TYPE "CertificateType" AS ENUM ('CND_FEDERAL', 'ESTADUAL', 'MUNICIPAL', 'FGTS_CRF', 'CNDT_TRABALHISTA', 'FALENCIA');

-- CreateEnum
CREATE TYPE "ComplianceSubjectType" AS ENUM ('OBLIGATION', 'CERTIFICATE');

-- CreateTable
CREATE TABLE "compliance_obligations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "type" "ComplianceObligationType" NOT NULL,
    "title" TEXT NOT NULL,
    "recurrence" "ObligationRecurrence" NOT NULL,
    "due_day" INTEGER,
    "due_month" INTEGER,
    "next_due_date" DATE NOT NULL,
    "status" "ObligationStatus" NOT NULL DEFAULT 'PENDENTE',
    "notes" TEXT,
    "actor_type" "AuditActorType" NOT NULL,
    "actor_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "compliance_obligations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_obligation_completions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "obligation_id" TEXT NOT NULL,
    "due_date" DATE NOT NULL,
    "completed_on" DATE NOT NULL,
    "notes" TEXT,
    "document_id" TEXT,
    "actor_type" "AuditActorType" NOT NULL,
    "actor_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compliance_obligation_completions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certificates" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "type" "CertificateType" NOT NULL,
    "issuer" TEXT,
    "code" TEXT,
    "issued_on" DATE NOT NULL,
    "valid_until" DATE NOT NULL,
    "notes" TEXT,
    "document_id" TEXT,
    "actor_type" "AuditActorType" NOT NULL,
    "actor_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "certificates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_reminders" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "subject_type" "ComplianceSubjectType" NOT NULL,
    "subject_id" TEXT NOT NULL,
    "due_date" DATE NOT NULL,
    "offset_days" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compliance_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "compliance_obligations_organization_id_status_next_due_date_idx" ON "compliance_obligations"("organization_id", "status", "next_due_date");

-- CreateIndex
CREATE INDEX "compliance_obligation_completions_organization_id_idx" ON "compliance_obligation_completions"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "compliance_obligation_completions_obligation_id_due_date_key" ON "compliance_obligation_completions"("obligation_id", "due_date");

-- CreateIndex
CREATE INDEX "certificates_organization_id_type_valid_until_idx" ON "certificates"("organization_id", "type", "valid_until");

-- CreateIndex
CREATE INDEX "compliance_reminders_organization_id_idx" ON "compliance_reminders"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "compliance_reminders_subject_type_subject_id_due_date_offse_key" ON "compliance_reminders"("subject_type", "subject_id", "due_date", "offset_days");

-- AddForeignKey
ALTER TABLE "compliance_obligations" ADD CONSTRAINT "compliance_obligations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_obligation_completions" ADD CONSTRAINT "compliance_obligation_completions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_obligation_completions" ADD CONSTRAINT "compliance_obligation_completions_obligation_id_fkey" FOREIGN KEY ("obligation_id") REFERENCES "compliance_obligations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_obligation_completions" ADD CONSTRAINT "compliance_obligation_completions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_reminders" ADD CONSTRAINT "compliance_reminders_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "compliance_obligations"
  ADD CONSTRAINT "compliance_obligations_due_day_chk" CHECK ("due_day" IS NULL OR "due_day" BETWEEN 1 AND 31),
  ADD CONSTRAINT "compliance_obligations_due_month_chk" CHECK ("due_month" IS NULL OR "due_month" BETWEEN 1 AND 12),
  ADD CONSTRAINT "compliance_obligations_rule_chk" CHECK (
    ("recurrence" = 'ONCE' AND "due_day" IS NULL AND "due_month" IS NULL)
    OR ("recurrence" = 'MONTHLY' AND "due_day" IS NOT NULL AND "due_month" IS NULL)
    OR ("recurrence" = 'YEARLY' AND "due_day" IS NOT NULL AND "due_month" IS NOT NULL)
  );

ALTER TABLE "certificates"
  ADD CONSTRAINT "certificates_validity_chk" CHECK ("valid_until" >= "issued_on");

ALTER TABLE "compliance_reminders"
  ADD CONSTRAINT "compliance_reminders_offset_chk" CHECK ("offset_days" >= 0);
