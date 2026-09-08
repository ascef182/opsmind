-- AIRequest passa a aceitar ator sem humano (pré-requisito da Task 10):
-- scans automáticos de prospecção geram AIRequest sem um usuário que pediu
-- — actor_type/actor_id carregam quem/o-que disparou, replicando o padrão
-- já usado em AuditLog/Task/Lead. `user_id` vira opcional (nunca o
-- contrário). Sem RLS nova — a tabela já tem policy.

-- AlterTable
ALTER TABLE "ai_requests" ALTER COLUMN "user_id" DROP NOT NULL;
ALTER TABLE "ai_requests" ADD COLUMN     "actor_type" "AuditActorType" NOT NULL DEFAULT 'USER';
ALTER TABLE "ai_requests" ADD COLUMN     "actor_id" TEXT;
