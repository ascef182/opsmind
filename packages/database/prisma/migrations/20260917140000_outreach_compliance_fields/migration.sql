-- Compliance de cold outreach (CAN-SPAM/LGPD) + conexão real do Resend
-- (aquecimento de domínio). Escrita à mão, aplicada via `prisma migrate
-- deploy` (não `migrate dev`, que recusa rodar aqui — mesmo problema de
-- shadow database sem a extensão `vector` já documentado em
-- 20260902120000_leads_prospecting/migration.sql).

-- Endereço físico de correspondência, exigido em todo e-mail de outreach por
-- lei (CAN-SPAM) — `OutreachService.send()` recusa enviar sem isso
-- preenchido pela organização.
ALTER TABLE "organizations" ADD COLUMN "outreach_physical_address" TEXT;

-- Opt-out de outreach — ortogonal ao pipeline de venda (`leads.status`).
-- Setado manualmente por um humano depois de ver um pedido de descadastro
-- (reply de e-mail, mensagem de WhatsApp); checado por
-- `OutreachService.send()` antes de todo envio real.
ALTER TABLE "leads" ADD COLUMN "unsubscribed_at" TIMESTAMP(3);
