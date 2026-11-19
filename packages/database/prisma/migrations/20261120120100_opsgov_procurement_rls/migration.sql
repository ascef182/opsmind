-- Row-Level Security das tabelas do OpsGov Fase 6 — mesmo padrão de
-- 20260827164710_enable_row_level_security (ver lá o motivo da branch
-- `IS NULL`).

ALTER TABLE "technical_certificates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "technical_certificates" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "technical_certificates"
  USING (
    "organization_id" = current_setting('app.current_org_id', true)
    OR NULLIF(current_setting('app.current_org_id', true), '') IS NULL
  );

ALTER TABLE "procurement_opportunities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "procurement_opportunities" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "procurement_opportunities"
  USING (
    "organization_id" = current_setting('app.current_org_id', true)
    OR NULLIF(current_setting('app.current_org_id', true), '') IS NULL
  );

ALTER TABLE "procurement_status_changes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "procurement_status_changes" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "procurement_status_changes"
  USING (
    "organization_id" = current_setting('app.current_org_id', true)
    OR NULLIF(current_setting('app.current_org_id', true), '') IS NULL
  );

ALTER TABLE "procurement_requirements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "procurement_requirements" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "procurement_requirements"
  USING (
    "organization_id" = current_setting('app.current_org_id', true)
    OR NULLIF(current_setting('app.current_org_id', true), '') IS NULL
  );
