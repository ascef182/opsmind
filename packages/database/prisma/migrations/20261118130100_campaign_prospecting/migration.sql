-- Estrutura das campanhas de prospecção. Só acrescenta: colunas nulas ou com
-- default, duas tabelas novas, índices e RLS. Nenhum dado existente muda aqui;
-- o preenchimento fica em 20261118130200_campaign_prospecting_backfill.

-- AlterTable
ALTER TABLE "sales_campaigns" ADD COLUMN     "archived_at" TIMESTAMP(3),
ADD COLUMN     "city" TEXT,
ADD COLUMN     "completed_at" TIMESTAMP(3),
ADD COLUMN     "creation_source" "CampaignCreationSource" NOT NULL DEFAULT 'USER',
ADD COLUMN     "identity_key" TEXT,
ADD COLUMN     "kind" "CampaignKind" NOT NULL DEFAULT 'STANDARD',
ADD COLUMN     "segment" TEXT,
ADD COLUMN     "state" TEXT;

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "disqualification_reason" TEXT,
ADD COLUMN     "duplicate_of_lead_id" TEXT,
ADD COLUMN     "entity_type" "LeadEntityType" NOT NULL DEFAULT 'UNKNOWN';

-- AlterTable
ALTER TABLE "outreach_messages" ADD COLUMN     "campaign_attribution" "OutreachCampaignAttribution" NOT NULL DEFAULT 'DRAFT_CONTEXT',
ADD COLUMN     "campaign_id" TEXT;

-- CreateTable
CREATE TABLE "campaign_leads" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "origin" "CampaignLeadOrigin" NOT NULL,
    "first_scrape_job_id" TEXT,
    "last_scrape_job_id" TEXT,
    "first_found_at" TIMESTAMP(3) NOT NULL,
    "last_found_at" TIMESTAMP(3) NOT NULL,
    "times_found" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_leads_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "campaign_leads_found_order_check" CHECK ("first_found_at" <= "last_found_at"),
    CONSTRAINT "campaign_leads_times_found_check" CHECK ("times_found" >= 1)
);

-- CreateTable
CREATE TABLE "lead_duplicate_candidates" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "lead_a_id" TEXT NOT NULL,
    "lead_b_id" TEXT NOT NULL,
    "reasons" TEXT[],
    "status" "DuplicateCandidateStatus" NOT NULL DEFAULT 'PENDING',
    "reviewed_by_user_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_duplicate_candidates_pkey" PRIMARY KEY ("id"),
    -- Par sempre ordenado: (A,B) e (B,A) nunca coexistem.
    CONSTRAINT "lead_duplicate_candidates_order_check" CHECK ("lead_a_id" < "lead_b_id")
);

ALTER TABLE "leads" ADD CONSTRAINT "leads_not_duplicate_of_self_check" CHECK ("duplicate_of_lead_id" IS NULL OR "duplicate_of_lead_id" <> "id");

-- CreateIndex
CREATE INDEX "campaign_leads_organization_id_lead_id_idx" ON "campaign_leads"("organization_id", "lead_id");
CREATE INDEX "campaign_leads_organization_id_campaign_id_last_found_at_idx" ON "campaign_leads"("organization_id", "campaign_id", "last_found_at");
CREATE UNIQUE INDEX "campaign_leads_campaign_id_lead_id_key" ON "campaign_leads"("campaign_id", "lead_id");
CREATE INDEX "lead_duplicate_candidates_organization_id_status_idx" ON "lead_duplicate_candidates"("organization_id", "status");
CREATE UNIQUE INDEX "lead_duplicate_candidates_lead_a_id_lead_b_id_key" ON "lead_duplicate_candidates"("lead_a_id", "lead_b_id");
CREATE INDEX "outreach_messages_organization_id_campaign_id_status_idx" ON "outreach_messages"("organization_id", "campaign_id", "status");

-- Uma campanha viva (ativa ou pausada) por segmento + cidade + estado.
-- Finalizada e arquivada não bloqueiam criar outra igual.
CREATE UNIQUE INDEX "sales_campaigns_identity_live_key" ON "sales_campaigns"("organization_id", "identity_key")
  WHERE "kind" = 'STANDARD' AND "status" IN ('ACTIVE', 'PAUSED');
-- No máximo uma campanha de legado e uma de cadastro manual por organização.
CREATE UNIQUE INDEX "sales_campaigns_special_kind_key" ON "sales_campaigns"("organization_id", "kind")
  WHERE "kind" IN ('LEGACY', 'MANUAL_ENTRY');

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_duplicate_of_lead_id_fkey" FOREIGN KEY ("duplicate_of_lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- NO ACTION (não RESTRICT): bloqueia apagar uma campanha com mensagens, mas
-- deixa o CASCADE de organização passar (checado no fim do comando).
ALTER TABLE "outreach_messages" ADD CONSTRAINT "outreach_messages_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "sales_campaigns"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "campaign_leads" ADD CONSTRAINT "campaign_leads_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Mesmo racional: o histórico de participação nunca some apagando só a campanha.
ALTER TABLE "campaign_leads" ADD CONSTRAINT "campaign_leads_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "sales_campaigns"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "campaign_leads" ADD CONSTRAINT "campaign_leads_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "campaign_leads" ADD CONSTRAINT "campaign_leads_first_scrape_job_id_fkey" FOREIGN KEY ("first_scrape_job_id") REFERENCES "scrape_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "campaign_leads" ADD CONSTRAINT "campaign_leads_last_scrape_job_id_fkey" FOREIGN KEY ("last_scrape_job_id") REFERENCES "scrape_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "lead_duplicate_candidates" ADD CONSTRAINT "lead_duplicate_candidates_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lead_duplicate_candidates" ADD CONSTRAINT "lead_duplicate_candidates_lead_a_id_fkey" FOREIGN KEY ("lead_a_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lead_duplicate_candidates" ADD CONSTRAINT "lead_duplicate_candidates_lead_b_id_fkey" FOREIGN KEY ("lead_b_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lead_duplicate_candidates" ADD CONSTRAINT "lead_duplicate_candidates_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Row-Level Security — mesmo padrão de 20260827164710_enable_row_level_security
-- (ver lá o motivo da branch `IS NULL`). A policy sem WITH CHECK aplica o
-- USING também a INSERT/UPDATE: não dá para gravar linha de outra organização.
ALTER TABLE "campaign_leads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "campaign_leads" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "campaign_leads"
  USING (
    "organization_id" = current_setting('app.current_org_id', true)
    OR NULLIF(current_setting('app.current_org_id', true), '') IS NULL
  );

ALTER TABLE "lead_duplicate_candidates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lead_duplicate_candidates" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "lead_duplicate_candidates"
  USING (
    "organization_id" = current_setting('app.current_org_id', true)
    OR NULLIF(current_setting('app.current_org_id', true), '') IS NULL
  );
