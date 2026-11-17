-- Sales Copy Intelligence: a abordagem do primeiro contato é escolhida por
-- regra (`selectOutreachStrategy`, shared-types) e cada rascunho guarda a
-- abordagem, a revisão de qualidade e o texto original da IA. Só colunas em
-- tabelas que já têm RLS; nenhuma política nova.

-- Que tipo de produto uma oferta é. Permite escolher a oferta pela
-- abordagem (sem site -> site; WhatsApp -> DeskComm) sem adivinhar pelo nome.
CREATE TYPE "OfferingKind" AS ENUM ('WEBSITE', 'WHATSAPP_AUTOMATION', 'CUSTOM_APP', 'OTHER');

ALTER TABLE "service_offerings" ADD COLUMN "kind" "OfferingKind";

UPDATE "service_offerings" SET "kind" = 'WHATSAPP_AUTOMATION'
WHERE "kind" IS NULL AND (name ILIKE '%deskcomm%' OR name ILIKE '%whatsapp%');

UPDATE "service_offerings" SET "kind" = 'WEBSITE'
WHERE "kind" IS NULL AND (name ILIKE '%site%' OR name ILIKE '%landing%');

-- `strategy`: texto (não enum) para a lista evoluir sem migração.
-- `original_body`: o texto que a IA gerou; comparado com `body` mostra se o
-- humano precisou editar antes de aprovar, que é sinal de qualidade.
-- `prompt_version`: separa o desempenho de versões diferentes do prompt.
ALTER TABLE "outreach_messages"
  ADD COLUMN "strategy" TEXT,
  ADD COLUMN "quality_review" JSONB,
  ADD COLUMN "original_body" TEXT,
  ADD COLUMN "prompt_version" TEXT;

CREATE INDEX "outreach_messages_organization_id_strategy_idx"
  ON "outreach_messages" ("organization_id", "strategy");
