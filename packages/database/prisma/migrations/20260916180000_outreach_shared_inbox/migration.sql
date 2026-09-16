-- Inbox compartilhada de outreach (plano
-- pensando-como-empresa-com-agile-beaver.md, trilha B). Escrita à mão pelo
-- mesmo motivo documentado em 20260914120000_deals: `prisma migrate dev`
-- não roda de forma utilizável neste ambiente. Aplicada via `prisma migrate
-- deploy`.

-- AlterTable
ALTER TABLE "outreach_messages"
  ADD COLUMN "read_at" TIMESTAMP(3),
  ADD COLUMN "read_by_user_id" TEXT;

-- CreateIndex
CREATE INDEX "outreach_messages_organization_id_status_read_at_idx" ON "outreach_messages"("organization_id", "status", "read_at");

-- AddForeignKey
ALTER TABLE "outreach_messages" ADD CONSTRAINT "outreach_messages_read_by_user_id_fkey" FOREIGN KEY ("read_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
