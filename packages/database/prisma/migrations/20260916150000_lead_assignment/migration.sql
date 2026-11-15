-- Atribuição de dono do Lead (plano pensando-como-empresa-com-agile-beaver.md,
-- trilha B — roteamento). Escrita à mão pelo mesmo motivo documentado em
-- 20260914120000_deals: `prisma migrate dev` não roda de forma utilizável
-- neste ambiente. Aplicada via `prisma migrate deploy`.

-- AlterTable
ALTER TABLE "leads" ADD COLUMN "assigned_user_id" TEXT;

-- CreateIndex
CREATE INDEX "leads_organization_id_assigned_user_id_idx" ON "leads"("organization_id", "assigned_user_id");

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_assigned_user_id_fkey" FOREIGN KEY ("assigned_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
