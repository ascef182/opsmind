-- OpsGov Fase 6 — prontidão para licitações.
--
-- Decisões:
-- - procurement_opportunities guarda o status atual; cada mudança vira uma linha
--   em procurement_status_changes (append-only, com motivo). As transições
--   válidas (PROCUREMENT_TRANSITIONS, shared-types) são checadas no service sob
--   SELECT ... FOR UPDATE.
-- - Prontidão NÃO é gravada: depende da data da sessão e do estado das
--   certidões/CNAEs naquele dia, então é calculada (procurementReadiness).
-- - Requisito de CERTIDAO aponta para o TIPO, não para uma certidão: renovar a
--   certidão não exige refazer o checklist. CNAE é comparado com as atividades
--   vigentes na data da sessão. ATESTADO aponta para technical_certificates.
--   DOCUMENTO/DECLARACAO são marcados por uma pessoa (manually_met).
-- - CHECKs garantem que cada tipo de requisito só usa os seus campos.
-- - contract_id é UNIQUE e só existe com status GANHA: a conversão em cliente
--   + contrato acontece uma vez só.
-- - FKs para documents/customers/contracts/company_activities são SET NULL,
--   como nas fases anteriores; a pertença à mesma organização é validada no
--   service.
-- - RLS em 20261120120100_opsgov_procurement_rls.

-- CreateEnum
CREATE TYPE "ProcurementStatus" AS ENUM ('RADAR', 'ANALISE', 'PROPOSTA', 'DISPUTA', 'GANHA', 'PERDIDA', 'DESCARTADA');

-- CreateEnum
CREATE TYPE "ProcurementModality" AS ENUM ('PREGAO_ELETRONICO', 'PREGAO_PRESENCIAL', 'CONCORRENCIA', 'DISPENSA', 'INEXIGIBILIDADE', 'CREDENCIAMENTO', 'OUTRA');

-- CreateEnum
CREATE TYPE "ProcurementRequirementType" AS ENUM ('DOCUMENTO', 'CERTIDAO', 'ATESTADO', 'CNAE', 'DECLARACAO');

-- CreateEnum
CREATE TYPE "ProcurementRequirementSource" AS ENUM ('MANUAL', 'AI_SUGGESTION_CONFIRMED');

-- CreateTable
CREATE TABLE "technical_certificates" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "object" TEXT NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE,
    "value_cents" INTEGER,
    "company_activity_id" TEXT,
    "customer_id" TEXT,
    "contract_id" TEXT,
    "document_id" TEXT,
    "notes" TEXT,
    "actor_type" "AuditActorType" NOT NULL,
    "actor_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "technical_certificates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procurement_opportunities" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "agency" TEXT NOT NULL,
    "agency_code" TEXT,
    "process_number" TEXT,
    "modality" "ProcurementModality" NOT NULL,
    "object" TEXT NOT NULL,
    "edital_url" TEXT,
    "session_date" DATE,
    "proposal_deadline" DATE,
    "estimated_value_cents" INTEGER,
    "edital_document_id" TEXT,
    "status" "ProcurementStatus" NOT NULL DEFAULT 'RADAR',
    "status_changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "customer_id" TEXT,
    "contract_id" TEXT,
    "converted_at" TIMESTAMP(3),
    "actor_type" "AuditActorType" NOT NULL,
    "actor_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "procurement_opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procurement_status_changes" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "opportunity_id" TEXT NOT NULL,
    "from_status" "ProcurementStatus",
    "to_status" "ProcurementStatus" NOT NULL,
    "reason" TEXT,
    "actor_type" "AuditActorType" NOT NULL,
    "actor_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "procurement_status_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procurement_requirements" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "opportunity_id" TEXT NOT NULL,
    "type" "ProcurementRequirementType" NOT NULL,
    "description" TEXT NOT NULL,
    "certificate_type" "CertificateType",
    "required_cnae" TEXT,
    "technical_certificate_id" TEXT,
    "manually_met" BOOLEAN NOT NULL DEFAULT false,
    "document_id" TEXT,
    "source" "ProcurementRequirementSource" NOT NULL DEFAULT 'MANUAL',
    "notes" TEXT,
    "actor_type" "AuditActorType" NOT NULL,
    "actor_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "procurement_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "technical_certificates_organization_id_period_start_idx" ON "technical_certificates"("organization_id", "period_start");

-- CreateIndex
CREATE UNIQUE INDEX "procurement_opportunities_contract_id_key" ON "procurement_opportunities"("contract_id");

-- CreateIndex
CREATE INDEX "procurement_opportunities_organization_id_status_session_da_idx" ON "procurement_opportunities"("organization_id", "status", "session_date");

-- CreateIndex
CREATE INDEX "procurement_status_changes_organization_id_opportunity_id_c_idx" ON "procurement_status_changes"("organization_id", "opportunity_id", "created_at");

-- CreateIndex
CREATE INDEX "procurement_requirements_organization_id_opportunity_id_idx" ON "procurement_requirements"("organization_id", "opportunity_id");

-- AddForeignKey
ALTER TABLE "technical_certificates" ADD CONSTRAINT "technical_certificates_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "technical_certificates" ADD CONSTRAINT "technical_certificates_company_activity_id_fkey" FOREIGN KEY ("company_activity_id") REFERENCES "company_activities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "technical_certificates" ADD CONSTRAINT "technical_certificates_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "technical_certificates" ADD CONSTRAINT "technical_certificates_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "technical_certificates" ADD CONSTRAINT "technical_certificates_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_opportunities" ADD CONSTRAINT "procurement_opportunities_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_opportunities" ADD CONSTRAINT "procurement_opportunities_edital_document_id_fkey" FOREIGN KEY ("edital_document_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_opportunities" ADD CONSTRAINT "procurement_opportunities_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_opportunities" ADD CONSTRAINT "procurement_opportunities_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_status_changes" ADD CONSTRAINT "procurement_status_changes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_status_changes" ADD CONSTRAINT "procurement_status_changes_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "procurement_opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_requirements" ADD CONSTRAINT "procurement_requirements_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_requirements" ADD CONSTRAINT "procurement_requirements_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "procurement_opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_requirements" ADD CONSTRAINT "procurement_requirements_technical_certificate_id_fkey" FOREIGN KEY ("technical_certificate_id") REFERENCES "technical_certificates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_requirements" ADD CONSTRAINT "procurement_requirements_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "technical_certificates"
  ADD CONSTRAINT "technical_certificates_period_chk" CHECK ("period_end" IS NULL OR "period_end" >= "period_start"),
  ADD CONSTRAINT "technical_certificates_value_chk" CHECK ("value_cents" IS NULL OR "value_cents" >= 0);

ALTER TABLE "procurement_opportunities"
  ADD CONSTRAINT "procurement_opportunities_value_chk" CHECK ("estimated_value_cents" IS NULL OR "estimated_value_cents" >= 0),
  ADD CONSTRAINT "procurement_opportunities_conversion_chk" CHECK (
    ("contract_id" IS NULL AND "converted_at" IS NULL) OR ("status" = 'GANHA' AND "converted_at" IS NOT NULL)
  );

ALTER TABLE "procurement_requirements"
  ADD CONSTRAINT "procurement_requirements_fields_chk" CHECK (
    ("certificate_type" IS NULL OR "type" = 'CERTIDAO')
    AND ("type" <> 'CERTIDAO' OR "certificate_type" IS NOT NULL)
    AND ("required_cnae" IS NULL OR "type" = 'CNAE')
    AND ("type" <> 'CNAE' OR "required_cnae" ~ '^[0-9]{4}-[0-9]/[0-9]{2}$')
    AND ("technical_certificate_id" IS NULL OR "type" = 'ATESTADO')
    AND ("manually_met" = false OR "type" IN ('DOCUMENTO', 'DECLARACAO'))
  );
