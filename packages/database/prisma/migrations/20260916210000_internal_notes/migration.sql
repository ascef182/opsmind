-- Colaboração de equipe (plano pensando-como-empresa-com-agile-beaver.md,
-- trilha B) — notas internas em Deal/Lead com menção por seleção explícita.
-- Escrita à mão pelo mesmo motivo documentado em 20260914120000_deals:
-- `prisma migrate dev` não roda de forma utilizável neste ambiente. Aplicada
-- via `prisma migrate deploy`.

-- CreateTable
CREATE TABLE "internal_notes" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "deal_id" TEXT,
    "lead_id" TEXT,
    "body" TEXT NOT NULL,
    "mentioned_user_ids" TEXT[],
    "author_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "internal_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "internal_notes_organization_id_deal_id_idx" ON "internal_notes"("organization_id", "deal_id");

-- CreateIndex
CREATE INDEX "internal_notes_organization_id_lead_id_idx" ON "internal_notes"("organization_id", "lead_id");

-- AddForeignKey
ALTER TABLE "internal_notes" ADD CONSTRAINT "internal_notes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_notes" ADD CONSTRAINT "internal_notes_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_notes" ADD CONSTRAINT "internal_notes_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_notes" ADD CONSTRAINT "internal_notes_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
