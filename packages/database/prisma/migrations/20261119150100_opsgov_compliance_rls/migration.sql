-- Row-Level Security das tabelas do OpsGov Fase 4 — mesmo padrão de
-- 20260827164710_enable_row_level_security (ver lá o motivo da branch
-- `IS NULL`).

ALTER TABLE "compliance_obligations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "compliance_obligations" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "compliance_obligations"
  USING (
    "organization_id" = current_setting('app.current_org_id', true)
    OR NULLIF(current_setting('app.current_org_id', true), '') IS NULL
  );

ALTER TABLE "compliance_obligation_completions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "compliance_obligation_completions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "compliance_obligation_completions"
  USING (
    "organization_id" = current_setting('app.current_org_id', true)
    OR NULLIF(current_setting('app.current_org_id', true), '') IS NULL
  );

ALTER TABLE "certificates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "certificates" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "certificates"
  USING (
    "organization_id" = current_setting('app.current_org_id', true)
    OR NULLIF(current_setting('app.current_org_id', true), '') IS NULL
  );

ALTER TABLE "compliance_reminders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "compliance_reminders" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "compliance_reminders"
  USING (
    "organization_id" = current_setting('app.current_org_id', true)
    OR NULLIF(current_setting('app.current_org_id', true), '') IS NULL
  );
