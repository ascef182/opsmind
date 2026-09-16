-- Fechamento via assinatura eletrônica (plano
-- pensando-como-empresa-com-agile-beaver.md, trilha A). Escrita à mão pelo
-- mesmo motivo documentado em 20260914120000_deals: `prisma migrate dev`
-- não roda de forma utilizável neste ambiente. Aplicada via `prisma migrate
-- deploy`.

-- CreateEnum
CREATE TYPE "SignatureRequestStatus" AS ENUM ('SENT', 'SIGNED', 'DECLINED', 'CANCELED');

-- CreateTable
CREATE TABLE "deal_signature_requests" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "deal_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'clicksign',
    "external_envelope_id" TEXT NOT NULL,
    "external_document_id" TEXT NOT NULL,
    "status" "SignatureRequestStatus" NOT NULL DEFAULT 'SENT',
    "signer_name" TEXT NOT NULL,
    "signer_email" TEXT NOT NULL,
    "document_url" TEXT,
    "signed_at" TIMESTAMP(3),
    "canceled_at" TIMESTAMP(3),
    "actor_type" "AuditActorType" NOT NULL,
    "actor_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deal_signature_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "deal_signature_requests_organization_id_deal_id_idx" ON "deal_signature_requests"("organization_id", "deal_id");

-- CreateIndex
CREATE INDEX "deal_signature_requests_external_envelope_id_idx" ON "deal_signature_requests"("external_envelope_id");

-- AddForeignKey
ALTER TABLE "deal_signature_requests" ADD CONSTRAINT "deal_signature_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_signature_requests" ADD CONSTRAINT "deal_signature_requests_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
