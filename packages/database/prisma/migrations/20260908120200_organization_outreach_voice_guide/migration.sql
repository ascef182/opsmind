-- Guia de tom de voz de outreach por organização (Task 10): texto livre
-- curto, injetado como few-shot no prompt de `generate_outreach_message` —
-- sem isso, o prompt cai na orientação de tom padrão do
-- OUTREACH_SYSTEM_PROMPT. Sem migration de RLS separada — `organizations`
-- não é tabela tenant-owned (é o próprio tenant).

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "outreach_voice_guide" TEXT;
