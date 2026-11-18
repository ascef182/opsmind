-- Row-Level Security das tabelas do OpsGov Fase 1 — mesmo padrão de
-- 20260827164710_enable_row_level_security (ver lá o motivo da branch
-- `IS NULL`).

ALTER TABLE "company_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "company_profiles" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "company_profiles"
  USING (
    "organization_id" = current_setting('app.current_org_id', true)
    OR NULLIF(current_setting('app.current_org_id', true), '') IS NULL
  );

ALTER TABLE "company_registration_periods" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "company_registration_periods" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "company_registration_periods"
  USING (
    "organization_id" = current_setting('app.current_org_id', true)
    OR NULLIF(current_setting('app.current_org_id', true), '') IS NULL
  );

ALTER TABLE "tax_regime_periods" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tax_regime_periods" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tax_regime_periods"
  USING (
    "organization_id" = current_setting('app.current_org_id', true)
    OR NULLIF(current_setting('app.current_org_id', true), '') IS NULL
  );

ALTER TABLE "company_activities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "company_activities" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "company_activities"
  USING (
    "organization_id" = current_setting('app.current_org_id', true)
    OR NULLIF(current_setting('app.current_org_id', true), '') IS NULL
  );
