-- Row-Level Security das tabelas do OpsGov Fase 5 — mesmo padrão de
-- 20260827164710_enable_row_level_security (ver lá o motivo da branch
-- `IS NULL`).

ALTER TABLE "accounting_proposals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "accounting_proposals" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "accounting_proposals"
  USING (
    "organization_id" = current_setting('app.current_org_id', true)
    OR NULLIF(current_setting('app.current_org_id', true), '') IS NULL
  );

ALTER TABLE "accounting_decisions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "accounting_decisions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "accounting_decisions"
  USING (
    "organization_id" = current_setting('app.current_org_id', true)
    OR NULLIF(current_setting('app.current_org_id', true), '') IS NULL
  );
