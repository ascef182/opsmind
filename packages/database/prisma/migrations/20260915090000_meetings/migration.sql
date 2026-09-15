-- Agenda/reuniões (plano pensando-como-empresa-com-agile-beaver.md, item
-- "lembretes e agenda" do roadmap). Escrita à mão pelo mesmo motivo
-- documentado em 20260914120000_deals: `prisma migrate dev` não roda de
-- forma utilizável neste ambiente. Aplicada via `prisma migrate deploy`.

-- CreateTable
CREATE TABLE "meetings" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "deal_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "duration_minutes" INTEGER NOT NULL DEFAULT 30,
    "location" TEXT,
    "notes" TEXT,
    "reminder_notified_at" TIMESTAMP(3),
    "canceled_at" TIMESTAMP(3),
    "actor_type" "AuditActorType" NOT NULL,
    "actor_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meetings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "meetings_organization_id_deal_id_idx" ON "meetings"("organization_id", "deal_id");

-- CreateIndex
CREATE INDEX "meetings_scheduled_at_reminder_notified_at_idx" ON "meetings"("scheduled_at", "reminder_notified_at");

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
