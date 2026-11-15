-- Row-Level Security para "meetings" — mesmo padrão de
-- 20260827164710_enable_row_level_security e 20260914120100_deals_rls:
-- `NULLIF(current_setting(...), '') IS NULL` cobre o bootstrap do TenantGuard
-- e execução fora de request HTTP (scan de lembrete do worker), nunca
-- confunde tenants numa request autenticada de verdade.

ALTER TABLE "meetings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "meetings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "meetings"
  USING (
    "organization_id" = current_setting('app.current_org_id', true)
    OR NULLIF(current_setting('app.current_org_id', true), '') IS NULL
  );
