-- Row-Level Security para "deals" — mesmo padrão de
-- 20260827164710_enable_row_level_security e 20260902120100_leads_prospecting_rls:
-- `NULLIF(current_setting(...), '') IS NULL` cobre o bootstrap do TenantGuard
-- e execução fora de request HTTP (scripts/testes), nunca confunde tenants
-- numa request autenticada de verdade. Ver o comentário completo da migration
-- de RLS original para o raciocínio detalhado por trás dessa branch de
-- fallback.

ALTER TABLE "deals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "deals" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "deals"
  USING (
    "organization_id" = current_setting('app.current_org_id', true)
    OR NULLIF(current_setting('app.current_org_id', true), '') IS NULL
  );
