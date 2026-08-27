-- CreateEnum
CREATE TYPE "AIRequestStatus" AS ENUM ('SUCCESS', 'ERROR', 'BUDGET_EXCEEDED');

-- CreateTable
CREATE TABLE "ai_requests" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "session_id" TEXT,
    "model" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "latency_ms" INTEGER NOT NULL,
    "estimated_cost" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "status" "AIRequestStatus" NOT NULL,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_request_tool_calls" (
    "id" TEXT NOT NULL,
    "ai_request_id" TEXT NOT NULL,
    "tool_name" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "output" JSONB,
    "is_error" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_request_tool_calls_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_requests_organization_id_created_at_idx" ON "ai_requests"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_request_tool_calls_ai_request_id_idx" ON "ai_request_tool_calls"("ai_request_id");

-- AddForeignKey
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_request_tool_calls" ADD CONSTRAINT "ai_request_tool_calls_ai_request_id_fkey" FOREIGN KEY ("ai_request_id") REFERENCES "ai_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-Level Security (mesmo padrão de customers/tasks/activity_logs/
-- notifications/audit_logs — ver a migration enable_row_level_security para
-- o raciocínio completo por trás da branch "ausência de contexto" e do
-- NULLIF). ai_request_tool_calls não tem organization_id direto e é sempre
-- acessada via o AIRequest pai (nunca uma query própria no código) — sem
-- policy dedicada, mesmo critério já aplicado a invitations/users/etc.
ALTER TABLE "ai_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_requests" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ai_requests"
  USING (
    "organization_id" = current_setting('app.current_org_id', true)
    OR NULLIF(current_setting('app.current_org_id', true), '') IS NULL
  );
