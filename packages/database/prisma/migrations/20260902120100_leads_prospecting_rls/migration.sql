-- Row-Level Security para as 5 tabelas novas de Leads & Prospecting — mesmo
-- padrão de 20260827164710_enable_row_level_security e
-- 20260827210000_documents_rag: `NULLIF(current_setting(...), '') IS NULL`
-- cobre o bootstrap do TenantGuard e execução fora de request HTTP
-- (scripts/testes), nunca confunde tenants numa request autenticada de
-- verdade. Ver o comentário completo da migration de RLS original para o
-- raciocínio detalhado por trás dessa branch de fallback.

ALTER TABLE "service_offerings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "service_offerings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "service_offerings"
  USING (
    "organization_id" = current_setting('app.current_org_id', true)
    OR NULLIF(current_setting('app.current_org_id', true), '') IS NULL
  );

ALTER TABLE "scrape_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "scrape_jobs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "scrape_jobs"
  USING (
    "organization_id" = current_setting('app.current_org_id', true)
    OR NULLIF(current_setting('app.current_org_id', true), '') IS NULL
  );

ALTER TABLE "leads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leads" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "leads"
  USING (
    "organization_id" = current_setting('app.current_org_id', true)
    OR NULLIF(current_setting('app.current_org_id', true), '') IS NULL
  );

-- `organization_id` denormalizado aqui (não só via Lead) pelo mesmo motivo já
-- registrado no schema.prisma para document_chunks/automation_runs: RLS
-- precisa valer direto nesta tabela, sem depender de JOIN em leads.
ALTER TABLE "lead_enrichments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lead_enrichments" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "lead_enrichments"
  USING (
    "organization_id" = current_setting('app.current_org_id', true)
    OR NULLIF(current_setting('app.current_org_id', true), '') IS NULL
  );

ALTER TABLE "outreach_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outreach_messages" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "outreach_messages"
  USING (
    "organization_id" = current_setting('app.current_org_id', true)
    OR NULLIF(current_setting('app.current_org_id', true), '') IS NULL
  );
