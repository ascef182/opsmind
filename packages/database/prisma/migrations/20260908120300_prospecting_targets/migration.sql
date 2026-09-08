-- ProspectingTarget (Task 6/7/8): alvo de prospecção recorrente — cadastra
-- "cidade/estado/tipo de negócio" uma vez e o worker re-executa a busca
-- periodicamente (respeitando cooldown_days), em vez de o usuário disparar
-- um ScrapeJob manualmente toda vez. RLS entra na migration seguinte.

-- CreateTable
CREATE TABLE "prospecting_targets" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "business_type" TEXT NOT NULL,
    "source_type" "ScrapeSourceType" NOT NULL DEFAULT 'APIFY_GOOGLE_MAPS',
    "only_without_website" BOOLEAN NOT NULL DEFAULT true,
    "limit" INTEGER NOT NULL DEFAULT 50,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "cooldown_days" INTEGER NOT NULL DEFAULT 7,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prospecting_targets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "prospecting_targets_organization_id_is_active_idx" ON "prospecting_targets"("organization_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "prospecting_targets_organization_id_city_state_business_typ_key" ON "prospecting_targets"("organization_id", "city", "state", "business_type", "source_type");

-- AddForeignKey
ALTER TABLE "prospecting_targets" ADD CONSTRAINT "prospecting_targets_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
