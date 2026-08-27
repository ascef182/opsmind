-- Fase 5 (Automations) — só as tabelas novas deste schema.
--
-- Escrita à mão (mesmo workaround de sempre: `prisma migrate dev` recusa
-- rodar em ambiente não-interativo aqui) a partir de `prisma migrate diff
-- --from-url ... --to-schema-datamodel ...`, com o MESMO cuidado das
-- migrations anteriores desta sessão: o Postgres local (mesmo container/
-- banco `opsmind`) tem tabelas de outro projeto não relacionado
-- (`leads`, `outreach_messages`, etc.) E as tabelas de Documents/RAG de uma
-- branch irmã ainda não mesclada (`feat/fase4-documents-rag`) — como esta
-- branch parte de `main` (que ainda não tem Documents), o diff bruto do
-- Prisma propunha DROP TABLE/DROP TYPE para as duas coisas. Descartado; esta
-- migration só cria o que é do Automations.

-- CreateEnum
CREATE TYPE "AutomationTrigger" AS ENUM ('CUSTOMER_INACTIVE');

-- CreateEnum
CREATE TYPE "AutomationRunStatus" AS ENUM ('SUCCESS', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "automations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trigger" "AutomationTrigger" NOT NULL,
    "conditions" JSONB NOT NULL DEFAULT '{}',
    "actions" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_runs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "automation_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "status" "AutomationRunStatus" NOT NULL,
    "actor_type" "AuditActorType" NOT NULL,
    "actor_id" TEXT,
    "result" JSONB,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "automations_organization_id_trigger_enabled_idx" ON "automations"("organization_id", "trigger", "enabled");

-- CreateIndex
CREATE INDEX "automation_runs_organization_id_automation_id_created_at_idx" ON "automation_runs"("organization_id", "automation_id", "created_at");

-- CreateIndex
CREATE INDEX "automation_runs_automation_id_customer_id_status_idx" ON "automation_runs"("automation_id", "customer_id", "status");

-- AddForeignKey
ALTER TABLE "automations" ADD CONSTRAINT "automations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_automation_id_fkey" FOREIGN KEY ("automation_id") REFERENCES "automations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-Level Security (mesmo padrão de todo o resto do schema desde
-- feat/rls-tenant-isolation): NULLIF(current_setting(...), '') IS NULL cobre
-- o bootstrap do TenantGuard, execução fora de request HTTP (apps/worker,
-- scripts, testes) e a query com o "no contexto = allow" documentado desde a
-- Fase de RLS — nunca alcançável numa request HTTP autenticada de verdade.
ALTER TABLE "automations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "automations" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "automations"
  USING (
    "organization_id" = current_setting('app.current_org_id', true)
    OR NULLIF(current_setting('app.current_org_id', true), '') IS NULL
  );

ALTER TABLE "automation_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "automation_runs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "automation_runs"
  USING (
    "organization_id" = current_setting('app.current_org_id', true)
    OR NULLIF(current_setting('app.current_org_id', true), '') IS NULL
  );
