-- Dois novos triggers de automação para o radar de risco do funil ativo
-- (plano 2026-11-14): `DEAL_STAGE_STALE` (Deal parado numa etapa há tempo
-- demais) e `DEAL_SILENT_FOR` (Deal sem atividade recente). Isolado numa
-- migration própria porque `ALTER TYPE ... ADD VALUE` precisa da sua
-- própria transação — mesmo padrão de `20260908120100_outreach_channel_instagram_dm`.

-- AlterEnum
ALTER TYPE "AutomationTrigger" ADD VALUE 'DEAL_STAGE_STALE';
ALTER TYPE "AutomationTrigger" ADD VALUE 'DEAL_SILENT_FOR';
