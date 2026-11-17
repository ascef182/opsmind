-- Row-Level Security das tabelas do Revenue Engine — mesmo padrão de
-- 20260827164710_enable_row_level_security (ver lá o motivo da branch
-- `IS NULL`).

ALTER TABLE "pipeline_stage_transitions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pipeline_stage_transitions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "pipeline_stage_transitions"
  USING (
    "organization_id" = current_setting('app.current_org_id', true)
    OR NULLIF(current_setting('app.current_org_id', true), '') IS NULL
  );

ALTER TABLE "cost_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cost_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "cost_events"
  USING (
    "organization_id" = current_setting('app.current_org_id', true)
    OR NULLIF(current_setting('app.current_org_id', true), '') IS NULL
  );

ALTER TABLE "organization_revenue_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "organization_revenue_settings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "organization_revenue_settings"
  USING (
    "organization_id" = current_setting('app.current_org_id', true)
    OR NULLIF(current_setting('app.current_org_id', true), '') IS NULL
  );
