import type { CampaignLeadOrigin, Prisma, PrismaClient } from '@prisma/client';
import { findDuplicatePairs } from '@opsmind/shared-types';

// Participação de empresas em campanhas e candidatos a duplicata,
// compartilhados por apps/api e apps/worker.

type Db = PrismaClient | Prisma.TransactionClient;

export interface CampaignLeadInput {
  organizationId: string;
  campaignId: string;
  leadId: string;
  origin: CampaignLeadOrigin;
  scrapeJobId?: string | null;
  foundAt?: Date;
}

// Uma linha por (campanha, lead). A primeira ocorrência e a origem nunca são
// sobrescritas; nova descoberta só avança last_* e soma times_found. Reprocessar
// a mesma busca (retry) não conta de novo. Também move o ponteiro
// Lead.campaignId para esta campanha (a mais recente).
export async function recordCampaignLead(db: Db, input: CampaignLeadInput): Promise<void> {
  const foundAt = input.foundAt ?? new Date();
  const jobId = input.scrapeJobId ?? null;
  await db.$executeRaw`
    INSERT INTO "campaign_leads" ("id", "organization_id", "campaign_id", "lead_id", "origin",
      "first_scrape_job_id", "last_scrape_job_id", "first_found_at", "last_found_at", "times_found", "created_at", "updated_at")
    VALUES (gen_random_uuid()::text, ${input.organizationId}, ${input.campaignId}, ${input.leadId},
      ${input.origin}::"CampaignLeadOrigin", ${jobId}, ${jobId}, ${foundAt}, ${foundAt}, 1, now(), now())
    ON CONFLICT ("campaign_id", "lead_id") DO UPDATE SET
      "last_found_at" = GREATEST("campaign_leads"."last_found_at", EXCLUDED."last_found_at"),
      "last_scrape_job_id" = COALESCE(EXCLUDED."last_scrape_job_id", "campaign_leads"."last_scrape_job_id"),
      "times_found" = "campaign_leads"."times_found" + CASE
        WHEN EXCLUDED."last_scrape_job_id" IS NOT NULL
         AND EXCLUDED."last_scrape_job_id" IS NOT DISTINCT FROM "campaign_leads"."last_scrape_job_id" THEN 0
        ELSE 1 END,
      "updated_at" = now()
    WHERE "campaign_leads"."organization_id" = ${input.organizationId}`;
  await db.lead.updateMany({
    where: { id: input.leadId, organizationId: input.organizationId },
    data: { campaignId: input.campaignId },
  });
}

// Gera candidatos a duplicata (site normalizado, ou telefone + cidade) entre os
// leads da organização. Só cria pares novos: um par já revisado (confirmado ou
// descartado) nunca volta para PENDING. Nunca funde nem altera leads.
export async function syncDuplicateCandidates(
  db: Db,
  organizationId: string,
  onlyLeadIds?: string[],
): Promise<number> {
  if (onlyLeadIds && onlyLeadIds.length === 0) return 0;
  const leads = await db.lead.findMany({
    where: { organizationId },
    select: { id: true, website: true, phone: true, city: true },
  });
  const pairs = findDuplicatePairs(leads, onlyLeadIds ? new Set(onlyLeadIds) : undefined);
  if (pairs.length === 0) return 0;
  const created = await db.leadDuplicateCandidate.createMany({
    data: pairs.map((pair) => ({ organizationId, leadAId: pair.leadAId, leadBId: pair.leadBId, reasons: pair.reasons })),
    skipDuplicates: true,
  });
  return created.count;
}
