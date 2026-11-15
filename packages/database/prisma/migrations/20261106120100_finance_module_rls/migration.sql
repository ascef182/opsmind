-- Row-Level Security das tabelas do módulo financeiro — mesmo padrão de
-- 20260914120100_deals_rls (ver o comentário completo da migration
-- 20260827164710_enable_row_level_security sobre o ramo `IS NULL`, que cobre o
-- bootstrap do TenantGuard e execução fora de request HTTP).

ALTER TABLE "contracts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contracts" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "contracts"
  USING (
    "organization_id" = current_setting('app.current_org_id', true)
    OR NULLIF(current_setting('app.current_org_id', true), '') IS NULL
  );

ALTER TABLE "recurring_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "recurring_entries" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "recurring_entries"
  USING (
    "organization_id" = current_setting('app.current_org_id', true)
    OR NULLIF(current_setting('app.current_org_id', true), '') IS NULL
  );

ALTER TABLE "financial_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "financial_entries" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "financial_entries"
  USING (
    "organization_id" = current_setting('app.current_org_id', true)
    OR NULLIF(current_setting('app.current_org_id', true), '') IS NULL
  );

ALTER TABLE "financial_payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "financial_payments" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "financial_payments"
  USING (
    "organization_id" = current_setting('app.current_org_id', true)
    OR NULLIF(current_setting('app.current_org_id', true), '') IS NULL
  );
