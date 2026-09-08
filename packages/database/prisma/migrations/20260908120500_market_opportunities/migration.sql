-- RedditWatchTopic + MarketOpportunity (Task 12/13/14): termo/subreddit
-- monitorado -> worker busca menções recorrentes de um problema -> agrupa em
-- MarketOpportunity, um sinal de demanda de mercado ainda não atendida.
-- `topic_key` é a chave de dedup estável (ex.: slug do label do cluster) —
-- `title` sozinho não serve pra dedup porque é texto gerado por IA e varia a
-- cada execução, mesmo quando o cluster de menções é essencialmente o mesmo
-- problema. RLS entra na migration seguinte (as duas tabelas).

-- CreateEnum
CREATE TYPE "MarketOpportunityStatus" AS ENUM ('NEW', 'REVIEWING', 'PURSUING', 'DISMISSED');

-- CreateTable
CREATE TABLE "reddit_watch_topics" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "subreddit" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reddit_watch_topics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "market_opportunities" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "topic_key" TEXT NOT NULL,
    "problem_description" TEXT NOT NULL,
    "mention_count" INTEGER NOT NULL DEFAULT 0,
    "source_urls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sample_quotes" JSONB NOT NULL,
    "status" "MarketOpportunityStatus" NOT NULL DEFAULT 'NEW',
    "suggested_offering_id" TEXT,
    "discovered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "market_opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reddit_watch_topics_organization_id_is_active_idx" ON "reddit_watch_topics"("organization_id", "is_active");

-- CreateIndex
CREATE INDEX "market_opportunities_organization_id_status_idx" ON "market_opportunities"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "market_opportunities_organization_id_topic_key_key" ON "market_opportunities"("organization_id", "topic_key");

-- AddForeignKey
ALTER TABLE "reddit_watch_topics" ADD CONSTRAINT "reddit_watch_topics_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_opportunities" ADD CONSTRAINT "market_opportunities_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_opportunities" ADD CONSTRAINT "market_opportunities_suggested_offering_id_fkey" FOREIGN KEY ("suggested_offering_id") REFERENCES "service_offerings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
