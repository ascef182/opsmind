-- Row-Level Security das tabelas do Harvey — mesmo padrão de
-- 20260827164710_enable_row_level_security (ver lá o motivo da branch
-- `IS NULL`).

ALTER TABLE "sales_campaigns" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sales_campaigns" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "sales_campaigns"
  USING (
    "organization_id" = current_setting('app.current_org_id', true)
    OR NULLIF(current_setting('app.current_org_id', true), '') IS NULL
  );

ALTER TABLE "harvey_agents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "harvey_agents" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "harvey_agents"
  USING (
    "organization_id" = current_setting('app.current_org_id', true)
    OR NULLIF(current_setting('app.current_org_id', true), '') IS NULL
  );

ALTER TABLE "harvey_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "harvey_runs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "harvey_runs"
  USING (
    "organization_id" = current_setting('app.current_org_id', true)
    OR NULLIF(current_setting('app.current_org_id', true), '') IS NULL
  );

ALTER TABLE "harvey_activities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "harvey_activities" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "harvey_activities"
  USING (
    "organization_id" = current_setting('app.current_org_id', true)
    OR NULLIF(current_setting('app.current_org_id', true), '') IS NULL
  );

-- Envios reivindicados/sem confirmação (reconciliação). Fica nesta migration
-- porque o Postgres não deixa usar valores novos de enum na mesma transação
-- em que foram criados (20261118120000 adiciona SENDING/SEND_UNKNOWN).
CREATE INDEX "outreach_messages_send_claimed_idx" ON "outreach_messages"("status", "send_claimed_at") WHERE "status" IN ('SENDING', 'SEND_UNKNOWN');
