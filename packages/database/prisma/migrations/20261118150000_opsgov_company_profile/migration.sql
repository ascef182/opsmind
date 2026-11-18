-- OpsGov Fase 1 — perfil da empresa e histórico de cadastro/regime/CNAEs.
--
-- Decisões:
-- - company_profiles é 1 por organização (UNIQUE em organization_id): dados de
--   exibição. O que muda com o tempo e tem efeito jurídico/tributário (natureza
--   jurídica + CNPJ, regime + modo IBS/CBS, CNAEs) mora em tabelas de vigência.
-- - Vigência = [valid_from, valid_to), DATE, valid_to NULL = vigente. Nada é
--   sobrescrito: a troca fecha o vigente e abre o novo na mesma transação
--   (CompanyProfileService + planPeriodChange, packages/shared-types).
-- - O banco é a última barreira contra sobreposição (duas requests
--   concorrentes, script mal feito): EXCLUDE USING gist com daterange. Precisa
--   de btree_gist para combinar "=" em organization_id com "&&" no intervalo;
--   a extensão é trusted desde o PG13, então o dono das migrations pode criá-la.
--   CNAE entra na chave de company_activities: CNAEs diferentes coexistem, o
--   mesmo CNAE não tem duas vigências sobrepostas.
-- - CNPJ do Cenário B (CNPJ novo na passagem a ME) é só outro período de
--   cadastro com cnpj diferente — por isso cnpj vive no período, não no perfil.
-- - document_id é o comprovante opcional (ON DELETE SET NULL: apagar o arquivo
--   não apaga o histórico). actor_type/actor_id seguem o padrão de contracts.
-- - RLS em 20261118150100_opsgov_company_profile_rls.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- CreateEnum
CREATE TYPE "NaturezaJuridica" AS ENUM ('MEI', 'EI', 'SLU', 'LTDA');

-- CreateEnum
CREATE TYPE "TaxRegime" AS ENUM ('SIMEI', 'SIMPLES_NACIONAL', 'LUCRO_PRESUMIDO', 'LUCRO_REAL');

-- CreateEnum
CREATE TYPE "IbsCbsMode" AS ENUM ('DENTRO_DAS', 'REGULAR', 'NAO_SE_APLICA');

-- CreateEnum
CREATE TYPE "AnexoSimples" AS ENUM ('I', 'II', 'III', 'IV', 'V', 'FATOR_R', 'NAO_DEFINIDO');

-- CreateEnum
CREATE TYPE "RevenueGroup" AS ENUM ('TECNOLOGIA', 'TRADUCAO_LEGENDAGEM', 'OUTROS');

-- CreateTable
CREATE TABLE "company_profiles" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "razao_social" TEXT NOT NULL,
    "nome_fantasia" TEXT,
    "cnpj" TEXT,
    "endereco_fiscal" TEXT,
    "municipio" TEXT,
    "uf" CHAR(2),
    "inscricao_municipal" TEXT,
    "inscricao_estadual" TEXT,
    "actor_type" "AuditActorType" NOT NULL,
    "actor_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_registration_periods" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "natureza_juridica" "NaturezaJuridica" NOT NULL,
    "cnpj" TEXT NOT NULL,
    "valid_from" DATE NOT NULL,
    "valid_to" DATE,
    "notes" TEXT,
    "document_id" TEXT,
    "actor_type" "AuditActorType" NOT NULL,
    "actor_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_registration_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_regime_periods" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "regime" "TaxRegime" NOT NULL,
    "ibs_cbs_mode" "IbsCbsMode" NOT NULL,
    "valid_from" DATE NOT NULL,
    "valid_to" DATE,
    "notes" TEXT,
    "document_id" TEXT,
    "actor_type" "AuditActorType" NOT NULL,
    "actor_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_regime_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_activities" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "cnae" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "anexo_simples" "AnexoSimples" NOT NULL DEFAULT 'NAO_DEFINIDO',
    "revenue_group" "RevenueGroup" NOT NULL DEFAULT 'OUTROS',
    "valid_from" DATE NOT NULL,
    "valid_to" DATE,
    "notes" TEXT,
    "document_id" TEXT,
    "actor_type" "AuditActorType" NOT NULL,
    "actor_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "company_profiles_organization_id_key" ON "company_profiles"("organization_id");

-- CreateIndex
CREATE INDEX "company_registration_periods_organization_id_valid_from_idx" ON "company_registration_periods"("organization_id", "valid_from");

-- CreateIndex
CREATE INDEX "tax_regime_periods_organization_id_valid_from_idx" ON "tax_regime_periods"("organization_id", "valid_from");

-- CreateIndex
CREATE INDEX "company_activities_organization_id_cnae_valid_from_idx" ON "company_activities"("organization_id", "cnae", "valid_from");

-- AddForeignKey
ALTER TABLE "company_profiles" ADD CONSTRAINT "company_profiles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_registration_periods" ADD CONSTRAINT "company_registration_periods_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_registration_periods" ADD CONSTRAINT "company_registration_periods_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_regime_periods" ADD CONSTRAINT "tax_regime_periods_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_regime_periods" ADD CONSTRAINT "tax_regime_periods_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_activities" ADD CONSTRAINT "company_activities_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_activities" ADD CONSTRAINT "company_activities_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Vigência válida e sem sobreposição.
ALTER TABLE "company_registration_periods"
  ADD CONSTRAINT "company_registration_periods_range_chk" CHECK ("valid_to" IS NULL OR "valid_to" > "valid_from"),
  ADD CONSTRAINT "company_registration_periods_cnpj_chk" CHECK ("cnpj" ~ '^[0-9]{14}$'),
  ADD CONSTRAINT "company_registration_periods_no_overlap"
    EXCLUDE USING gist ("organization_id" WITH =, daterange("valid_from", "valid_to") WITH &&);

ALTER TABLE "tax_regime_periods"
  ADD CONSTRAINT "tax_regime_periods_range_chk" CHECK ("valid_to" IS NULL OR "valid_to" > "valid_from"),
  ADD CONSTRAINT "tax_regime_periods_no_overlap"
    EXCLUDE USING gist ("organization_id" WITH =, daterange("valid_from", "valid_to") WITH &&);

ALTER TABLE "company_activities"
  ADD CONSTRAINT "company_activities_range_chk" CHECK ("valid_to" IS NULL OR "valid_to" > "valid_from"),
  ADD CONSTRAINT "company_activities_cnae_chk" CHECK ("cnae" ~ '^[0-9]{4}-[0-9]/[0-9]{2}$'),
  ADD CONSTRAINT "company_activities_no_overlap"
    EXCLUDE USING gist ("organization_id" WITH =, "cnae" WITH =, daterange("valid_from", "valid_to") WITH &&);

-- No máximo uma atividade principal em aberto (o service checa também a
-- sobreposição de principais em datas passadas).
CREATE UNIQUE INDEX "company_activities_one_open_primary"
  ON "company_activities"("organization_id") WHERE "is_primary" AND "valid_to" IS NULL;
