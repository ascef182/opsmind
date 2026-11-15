-- Row-Level Security de lead_signals/signal_codes — mesmo padrão de
-- 20261106120100_finance_module_rls (ver o comentário completo da migration
-- 20260827164710_enable_row_level_security sobre o ramo `IS NULL`, que cobre
-- o bootstrap do TenantGuard e execução fora de request HTTP).

ALTER TABLE "lead_signals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lead_signals" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "lead_signals"
  USING (
    "organization_id" = current_setting('app.current_org_id', true)
    OR NULLIF(current_setting('app.current_org_id', true), '') IS NULL
  );

-- signal_codes é a ÚNICA tabela deste schema com organization_id
-- intencionalmente nulo em algumas linhas (vocabulário global, semeado por
-- migration, visível para toda organização) — por isso a política abaixo
-- tem um terceiro ramo (`"organization_id" IS NULL`) que nenhuma outra
-- política de RLS do projeto tem. Sem esse ramo, uma linha global ficaria
-- invisível para TODA organização (a comparação `organization_id =
-- current_setting(...)` nunca é verdadeira quando organization_id é NULL,
-- mesmo com a sessão corretamente configurada) — o oposto do que se quer.
ALTER TABLE "signal_codes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "signal_codes" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "signal_codes"
  USING (
    "organization_id" = current_setting('app.current_org_id', true)
    OR "organization_id" IS NULL
    OR NULLIF(current_setting('app.current_org_id', true), '') IS NULL
  );
