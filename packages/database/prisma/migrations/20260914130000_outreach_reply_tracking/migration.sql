-- Rastreio de resposta + lembrete de follow-up (plano
-- pensando-como-empresa-com-agile-beaver.md). Escrita à mão pelo mesmo
-- motivo documentado em 20260902000000_deals: `prisma migrate dev` não roda
-- de forma utilizável neste ambiente (shadow database sem a extensão
-- `vector`). Aplicada via `prisma migrate deploy`.
--
-- `provider_message_id`: id retornado pelo Resend no envio real
-- (OutreachService.send) — correlaciona uma resposta recebida via webhook
-- inbound de volta a esta linha, sem adivinhar organização/lead por
-- endereço de email (evita ambiguidade cross-tenant).
-- `follow_up_notified_at`: dedup do scan de follow-up do worker — nunca
-- notifica duas vezes a mesma mensagem sem resposta.

-- AlterTable
ALTER TABLE "outreach_messages"
  ADD COLUMN "provider_message_id" TEXT,
  ADD COLUMN "follow_up_notified_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "outreach_messages_status_sent_at_idx" ON "outreach_messages"("status", "sent_at");
