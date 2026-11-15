-- Fase 4 (Documentos + RAG) — só as tabelas novas deste schema.
--
-- Escrita à mão (não gerada por `prisma migrate dev`, que recusa rodar em
-- ambiente não-interativo aqui) a partir de `prisma migrate diff --from-url
-- ... --to-schema-datamodel ...`, mas com um cuidado extra desta vez: o
-- Postgres local (mesmo container/banco `opsmind`) tem tabelas de OUTRO
-- projeto não relacionado (`leads`, `lead_enrichments`, `outreach_messages`,
-- `scrape_jobs`, `service_offerings` — aplicadas minutos antes desta
-- migration, por uma sessão/projeto "prospecting" diferente apontando pro
-- mesmo banco). O diff bruto continha DROP TABLE/DROP TYPE para todas elas,
-- porque não existem no schema.prisma do OpsMind. Este arquivo contém só as
-- instruções CREATE relevantes ao OpsMind — nada que toque nas tabelas do
-- outro projeto.

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('PROCESSING', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "storage_url" TEXT NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'PROCESSING',
    "error_message" TEXT,
    "uploaded_by_user_id" TEXT NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_chunks" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" vector(1536),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "documents_organization_id_status_idx" ON "documents"("organization_id", "status");

-- CreateIndex
CREATE INDEX "documents_organization_id_customer_id_idx" ON "documents"("organization_id", "customer_id");

-- CreateIndex
CREATE INDEX "document_chunks_document_id_chunk_index_idx" ON "document_chunks"("document_id", "chunk_index");

-- Índice HNSW para busca por similaridade de cosseno (SearchDocumentsTool).
-- HNSW em vez de IVFFlat: não precisa de dados presentes para "treinar" as
-- listas (IVFFlat degrada muito com poucas linhas, exatamente o cenário de
-- um workspace novo), e é o default recomendado do pgvector hoje.
CREATE INDEX "document_chunks_embedding_hnsw_idx" ON "document_chunks"
  USING hnsw ("embedding" vector_cosine_ops);

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-Level Security (mesmo padrão de todo o resto do schema desde
-- feat/rls-tenant-isolation): NULLIF(current_setting(...), '') IS NULL cobre
-- o bootstrap do TenantGuard e execução fora de request HTTP (scripts/testes),
-- nunca confunde tenants numa request autenticada de verdade.
ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "documents" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "documents"
  USING (
    "organization_id" = current_setting('app.current_org_id', true)
    OR NULLIF(current_setting('app.current_org_id', true), '') IS NULL
  );

-- `organization_id` denormalizado aqui especificamente para a RLS poder ser
-- aplicada direto nesta tabela (decisão da Fase 1 — ver comentário no topo
-- do schema.prisma): a busca por similaridade (SearchDocumentsTool) roda
-- direto em document_chunks, sem JOIN em documents, e precisa do isolamento
-- de tenant garantido pelo próprio banco nessa query.
ALTER TABLE "document_chunks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document_chunks" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "document_chunks"
  USING (
    "organization_id" = current_setting('app.current_org_id', true)
    OR NULLIF(current_setting('app.current_org_id', true), '') IS NULL
  );
