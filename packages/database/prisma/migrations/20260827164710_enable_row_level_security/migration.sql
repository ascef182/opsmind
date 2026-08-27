-- Row-Level Security — defesa em profundidade além do escopo por
-- organização já aplicado em toda query de service (docs/planning/reviews/
-- database-reviewer-review.md §1.3). Só tem efeito real porque a API conecta
-- como `opsmind_app`, uma role sem BYPASSRLS (infra/docker/init/02-app-role.sql)
-- — o dono das tabelas (`opsmind`, usado por migrations/seed) sempre ignora
-- RLS, superusuário ignora mesmo com FORCE ROW LEVEL SECURITY.
--
-- Duas variáveis de sessão, setadas pelo TenantContextInterceptor
-- (apps/api/src/shared/interceptors/tenant-context.interceptor.ts):
--   - app.current_user_id: sempre que a request está autenticada.
--   - app.current_org_id: só quando a rota passou pelo TenantGuard.
--
-- IMPORTANTE — por que toda policy abaixo tem uma branch "OR ... IS NULL":
-- Guards do NestJS rodam ANTES de interceptors. TenantGuard (um guard)
-- consulta `memberships` para decidir se autoriza a request — nesse
-- instante, o TenantContextInterceptor (que só roda depois de todos os
-- guards) ainda não abriu transação nenhuma, então NENHUMA variável de
-- sessão existe ainda. Sem uma exceção para "contexto ausente", essa
-- consulta seria negada pela própria RLS, e ninguém nunca conseguiria
-- passar pelo TenantGuard. O mesmo vale para testes e2e que leem o banco
-- direto via PrismaService fora de uma request HTTP (verificação de
-- resultado), e para scripts/seed futuros.
--
-- Isso não reabre a brecha que a RLS existe pra fechar: uma request real,
-- autenticada, que erroneamente tentasse ler dados de outra organização
-- SEMPRE tem app.current_org_id setado (para o valor da organização que a
-- própria rota autorizou via TenantGuard) — a branch "ausência de contexto"
-- nunca fica verdadeira nesse caminho. Ela só é alcançada por consultas que
-- nunca passaram pelo interceptor (bootstrap do guard, testes, scripts) —
-- nenhuma delas é um client HTTP confundindo tenants.
--
-- Por que `NULLIF(current_setting(...), '') IS NULL` e não só
-- `current_setting(...) IS NULL`: confirmado empiricamente nesta sessão que
-- `SET LOCAL`/`set_config(name, value, true)` sobre um GUC customizado
-- (`app.*`) que NUNCA teve valor de sessão, ao expirar no fim da transação,
-- volta para STRING VAZIA — não NULL — em qualquer conexão do pool que já
-- tenha setado essa variável antes (só uma conexão nova em folha, que nunca
-- tocou o GUC, mostra NULL de verdade). Checar só `IS NULL` fazia a branch
-- de fallback nunca disparar de novo depois da primeira transação usar
-- aquela conexão — foi exatamente isso que quebrou TenantGuard e todo
-- resto em cascata na primeira tentativa desta migration.

-- ── memberships e organizations: por user_id, não por org_id ───────────────
-- Não dá pra usar app.current_org_id aqui: é exatamente a query em
-- `memberships` que descobre se um org_id é válido para o usuário (o
-- TenantGuard consulta Membership ANTES de existir qualquer org_id
-- confirmado). Usar current_org_id como único critério criaria um paradoxo
-- circular; por isso `user_id = current_user_id` é a branch principal, com
-- `organization_id = current_org_id` cobrindo as ações de um OWNER/ADMIN
-- sobre o membership de OUTRA pessoa (updateRole/remove/listar membros) —
-- ali user_id nunca bate com current_user_id, mas org_id bate.

ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "memberships" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "memberships"
  USING (
    "user_id" = current_setting('app.current_user_id', true)
    OR "organization_id" = current_setting('app.current_org_id', true)
    OR NULLIF(current_setting('app.current_user_id', true), '') IS NULL
  );

-- `organizations` fica DELIBERADAMENTE sem RLS — não por falta de tentativa.
-- O Membership do dono é inserido na MESMA transação, logo depois da
-- Organization (OrganizationsService.create); na hora de inserir a
-- Organization, esse Membership ainda não existe. Isso por si só é
-- contornável com `WITH CHECK (true)` — mas Prisma sempre faz
-- `INSERT ... RETURNING`, e o Postgres aplica a cláusula USING (leitura)
-- também sobre a linha recém-inserida antes de devolvê-la (confirmado
-- empiricamente com audit_logs, mesma sessão). Como USING precisa checar
-- "existe Membership deste usuário nesta org" e esse Membership ainda não
-- existe no instante do INSERT, toda criação de organização quebraria.
-- A única saída limpa seria inserir via SQL cru (sem RETURNING) e reler
-- depois — mas `updated_at` não tem default no banco (Prisma seta no
-- client), então isso significa duplicar manualmente, em SQL cru, uma
-- lista de defaults que já existe no schema — um jeito fácil de os dois
-- ficarem dessincronizados na próxima migration. O escopo por membership já
-- é aplicado e testado na camada de aplicação (findByIdForUser/listForUser,
-- ver organizations.service.spec.ts e o teste e2e de IDOR em
-- organizations.e2e-spec.ts) — RLS aqui seria defesa em profundidade
-- adicional, não a única proteção, e o custo de mantê-la não compensa dado
-- o problema estrutural do RETURNING.

-- ── tabelas escopadas por organização direta ────────────────────────────────

ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customers" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "customers"
  USING (
    "organization_id" = current_setting('app.current_org_id', true)
    OR NULLIF(current_setting('app.current_org_id', true), '') IS NULL
  );

ALTER TABLE "tasks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tasks" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tasks"
  USING (
    "organization_id" = current_setting('app.current_org_id', true)
    OR NULLIF(current_setting('app.current_org_id', true), '') IS NULL
  );

ALTER TABLE "activity_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "activity_logs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "activity_logs"
  USING (
    "organization_id" = current_setting('app.current_org_id', true)
    OR NULLIF(current_setting('app.current_org_id', true), '') IS NULL
  );

ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "notifications"
  USING (
    "organization_id" = current_setting('app.current_org_id', true)
    OR NULLIF(current_setting('app.current_org_id', true), '') IS NULL
  );

-- audit_logs.organization_id é nullable (eventos como "user.registered"
-- acontecem antes de qualquer organização existir — Decisão #8 da Fase 1) —
-- coberto pela mesma branch "IS NULL" de contexto ausente, já que rotas sem
-- TenantGuard que auditam um organization_id real também existem
-- (OrganizationsService.create → "organization.created"; InvitationsService
-- .accept → "membership.accepted", via POST /invitations/:token/accept, que
-- não tem :organizationId de rota — o token é quem autoriza).
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "audit_logs"
  USING (
    "organization_id" = current_setting('app.current_org_id', true)
    OR "organization_id" IS NULL
    OR NULLIF(current_setting('app.current_org_id', true), '') IS NULL
  );

-- ── tabelas deliberadamente SEM RLS ──────────────────────────────────────
-- users, refresh_tokens, email_verification_tokens: não são dados de tenant
--   (um usuário pertence a organizações diferentes; refresh/verification
--   tokens já são só acessíveis pelo hash, nunca por filtro de sessão).
-- invitations: o token bruto (possuído só por quem recebeu o convite) já é
--   o segredo que autoriza aceitar — aplicar RLS por org_id teria o mesmo
--   paradoxo circular de Membership, mas sem um user_id pra usar em vez
--   disso (o convite existe antes de a pessoa convidada ter conta).
