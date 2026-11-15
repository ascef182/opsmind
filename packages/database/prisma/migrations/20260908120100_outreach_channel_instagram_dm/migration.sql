-- Novo canal de outreach (Task 10/11): Instagram DM, ao lado dos já
-- existentes. `ALTER TYPE ... ADD VALUE` em vez de recriar o enum — sintaxe
-- nativa do Postgres para adicionar valor a um tipo existente, sem downtime.

-- AlterEnum
ALTER TYPE "OutreachChannel" ADD VALUE 'INSTAGRAM_DM';
