-- Rollback das migrations 20261118130000/130100/130200 (campanhas de prospecção).
-- Uso manual: psql -v ON_ERROR_STOP=1 -f <este arquivo>. Roda numa transação só.
-- Restaura os valores guardados em `migration_backup` e remove a estrutura nova.
-- Os valores PAUSED/COMPLETED de "CampaignStatus" ficam no tipo (o Postgres não
-- remove valor de enum); nenhuma linha os usa depois do rollback.

BEGIN;

-- Recusa se já existe histórico novo ligado às campanhas criadas pela migration:
-- apagar essas campanhas apagaria ciclos do Harvey (CASCADE) ou quebraria mensagens.
DO $$
DECLARE
  n BIGINT;
BEGIN
  SELECT (SELECT count(*) FROM harvey_runs WHERE campaign_id IN (SELECT id FROM migration_backup.cm_created_campaigns))
       + (SELECT count(*) FROM harvey_activities WHERE campaign_id IN (SELECT id FROM migration_backup.cm_created_campaigns))
       + (SELECT count(*) FROM outreach_messages WHERE campaign_id IN (SELECT id FROM migration_backup.cm_created_campaigns))
       + (SELECT count(*) FROM prospecting_targets t WHERE NOT EXISTS (SELECT 1 FROM migration_backup.cm_targets b WHERE b.id = t.id))
    INTO n;
  IF n > 0 THEN
    RAISE EXCEPTION 'Rollback recusado: % registro(s) criados depois da migration dependem das campanhas novas. Restaure o backup do banco.', n;
  END IF;
END
$$;

ALTER TABLE outreach_messages DROP CONSTRAINT IF EXISTS outreach_messages_campaign_required_check;
ALTER TABLE sales_campaigns DROP CONSTRAINT IF EXISTS sales_campaigns_standard_identity_check;

UPDATE leads l SET campaign_id = b.campaign_id FROM migration_backup.cm_leads b WHERE b.id = l.id;
UPDATE scrape_jobs j SET campaign_id = b.campaign_id, prospecting_target_id = b.prospecting_target_id
  FROM migration_backup.cm_scrape_jobs b WHERE b.id = j.id;
UPDATE prospecting_targets t SET campaign_id = b.campaign_id, is_active = b.is_active FROM migration_backup.cm_targets b WHERE b.id = t.id;
UPDATE sales_campaigns c SET status = b.status::"CampaignStatus", archived_at = b.archived_at
  FROM migration_backup.cm_campaigns b WHERE b.id = c.id;

-- Leads criados depois da migration podem apontar para campanha nova.
UPDATE leads SET campaign_id = NULL WHERE campaign_id IN (SELECT id FROM migration_backup.cm_created_campaigns);
UPDATE scrape_jobs SET campaign_id = NULL WHERE campaign_id IN (SELECT id FROM migration_backup.cm_created_campaigns);

DROP TABLE campaign_leads;
DROP TABLE lead_duplicate_candidates;
DELETE FROM sales_campaigns WHERE id IN (SELECT id FROM migration_backup.cm_created_campaigns);

ALTER TABLE outreach_messages DROP COLUMN campaign_attribution, DROP COLUMN campaign_id;
ALTER TABLE leads DROP CONSTRAINT leads_not_duplicate_of_self_check,
  DROP COLUMN disqualification_reason, DROP COLUMN duplicate_of_lead_id, DROP COLUMN entity_type;
ALTER TABLE sales_campaigns DROP COLUMN archived_at, DROP COLUMN city, DROP COLUMN completed_at,
  DROP COLUMN creation_source, DROP COLUMN identity_key, DROP COLUMN kind, DROP COLUMN segment, DROP COLUMN state;

DROP SCHEMA migration_backup CASCADE;

DROP TYPE "CampaignKind";
DROP TYPE "CampaignCreationSource";
DROP TYPE "CampaignLeadOrigin";
DROP TYPE "LeadEntityType";
DROP TYPE "OutreachCampaignAttribution";
DROP TYPE "DuplicateCandidateStatus";

DELETE FROM _prisma_migrations WHERE migration_name IN (
  '20261118130000_campaign_prospecting_enums',
  '20261118130100_campaign_prospecting',
  '20261118130200_campaign_prospecting_backfill');


COMMIT;
