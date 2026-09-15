-- Lembrete de vencimento de tarefa + proposta assistida por IA (plano
-- pensando-como-empresa-com-agile-beaver.md). Escrita à mão pelo mesmo
-- motivo documentado em 20260914120000_deals: `prisma migrate dev` não roda
-- de forma utilizável neste ambiente. Aplicada via `prisma migrate deploy`.

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN "due_date_notified_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "deals"
  ADD COLUMN "proposal_draft" TEXT,
  ADD COLUMN "proposal_generated_at" TIMESTAMP(3);
