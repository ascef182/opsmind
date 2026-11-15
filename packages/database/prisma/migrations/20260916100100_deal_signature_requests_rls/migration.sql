-- Row-Level Security para "deal_signature_requests" — mesmo padrão de
-- 20260827164710_enable_row_level_security e 20260914120100_deals_rls:
-- `NULLIF(current_setting(...), '') IS NULL` cobre o bootstrap do
-- TenantGuard e execução fora de request HTTP, nunca confunde tenants numa
-- request autenticada de verdade.

ALTER TABLE "deal_signature_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "deal_signature_requests" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "deal_signature_requests"
  USING (
    "organization_id" = current_setting('app.current_org_id', true)
    OR NULLIF(current_setting('app.current_org_id', true), '') IS NULL
  );
