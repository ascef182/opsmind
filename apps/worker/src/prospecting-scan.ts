import type { PrismaClient, ScrapeJob } from '@opsmind/database';
import { getEngineBudgetStatus } from '@opsmind/database';
import type { LeadScrapeJobData } from '@opsmind/shared-types';
import type Redis from 'ioredis';
import * as Sentry from '@sentry/node';
import { isOverBudget } from './budget';

/**
 * Teto de `ScrapeJob`s criados por organização em CADA tick do scan — mesmo
 * espírito de `QUALIFICATION_THRESHOLD` (packages/shared-types/lead-scoring.ts):
 * um limite fixo e documentado aqui, não configurável por organização, que
 * evita uma única passada do scan enfileirar uma avalanche de jobs (e gasto)
 * de uma vez só para uma organização com muitos `ProspectingTarget` ativos.
 */
const PROSPECTING_MAX_JOBS_PER_ORG_PER_TICK = 5;

/**
 * Trigger (Task 7, planos de prospecção autônoma) — roda periodicamente (ver
 * main.ts), espelhando `scanCustomerInactiveAutomations`
 * (`automation-scan.ts`): acha `ProspectingTarget`s ativos que já podem
 * rodar de novo e enfileira um `ScrapeJob` por alvo pendente, nunca executa
 * o scraping aqui diretamente (isso é trabalho do `lead-scrape-processor`,
 * do outro lado da fila).
 *
 * Assinatura recebe `redis` além de `prisma`/`enqueueScrapeJob` — necessário
 * porque o corte de orçamento (`isOverBudget`, `./budget.ts`) é uma versão
 * framework-free apoiada em Redis (mesmo racional documentado no topo de
 * `budget.ts`), o mesmo cliente já injetado em `processLeadScrapeJob`
 * (`lead-scrape-processor.ts`) — não uma conexão nova.
 */
export async function scanProspectingTargets(
  prisma: PrismaClient,
  redis: Redis,
  // Retorno intencionalmente `unknown` — mesmo racional do `enqueue` de
  // `scanCustomerInactiveAutomations`: o chamador real (main.ts) passa
  // `queue.add(...)`, e o scan não precisa (nem deve) inspecionar o retorno.
  enqueueScrapeJob: (job: ScrapeJob, data: LeadScrapeJobData) => Promise<unknown>,
): Promise<number> {
  const targets = await prisma.prospectingTarget.findMany({
    where: { isActive: true },
    include: { organization: true },
  });

  let createdCount = 0;
  // Contagem só do que este tick criou até agora, por organização — não uma
  // contagem histórica no banco (o teto é "por tick", não "por dia"/"total").
  const createdThisTickByOrg = new Map<string, number>();

  for (const target of targets) {
    // Try/catch por target: uma falha isolada (ex.: violação de constraint,
    // erro transitório de rede no `enqueueScrapeJob`) nunca deve abortar o
    // resto do scan — os outros alvos, de outras organizações inclusive,
    // precisam continuar sendo processados. Só a função inteira tem, além
    // deste, o try/catch externo que `main.ts` já aplica (mesmo formato de
    // `runScan`).
    try {
      const alreadyCreatedForOrg = createdThisTickByOrg.get(target.organizationId) ?? 0;

      // Cooldown: pula se já existe um ScrapeJob equivalente (mesma
      // organização/cidade/estado/tipo de negócio/fonte) criado dentro da
      // janela de `cooldownDays` DESTE target (não uma constante global —
      // cada target define seu próprio ritmo de re-scan).
      //
      // Status que suprimem: COMPLETED (já coberto) + QUEUED/RUNNING (job
      // equivalente ainda em voo — criar outro duplicaria o trabalho e o
      // gasto a cada tick até o primeiro terminar). FAILED deliberadamente
      // NÃO suprime: um job que falhou não cobriu nada, então o próximo tick
      // deve poder tentar de novo.
      const cooldownCutoff = new Date(Date.now() - target.cooldownDays * 86_400_000);
      const recentJob = await prisma.scrapeJob.findFirst({
        where: {
          organizationId: target.organizationId,
          city: target.city,
          state: target.state,
          businessType: target.businessType,
          sourceType: target.sourceType,
          status: { in: ['COMPLETED', 'QUEUED', 'RUNNING'] },
          createdAt: { gt: cooldownCutoff },
        },
      });
      if (recentJob) {
        continue;
      }

      // Orçamento: mesmo `scrapingMonthlyBudget` que `lead-scrape-processor.ts`
      // já consulta antes de rodar um job — checado aqui de novo porque o
      // scan é quem decide SE cria o `ScrapeJob`, então o corte precisa
      // acontecer antes da criação da linha, nunca depois.
      const monthlyBudget =
        target.organization.scrapingMonthlyBudget !== null
          ? Number(target.organization.scrapingMonthlyBudget)
          : null;
      if (await isOverBudget(redis, target.organizationId, monthlyBudget)) {
        continue;
      }
      // Teto do Revenue Engine (razão de custos do mês, todas as categorias):
      // o scan diário é gasto autônomo, então para quando o teto estoura.
      if ((await getEngineBudgetStatus(prisma, target.organizationId)).exceeded) {
        continue;
      }

      // Teto por tick: conta só o que este tick já criou para a organização
      // do target atual — o 6º target ativo da mesma organização no mesmo
      // tick nunca chega a criar um `ScrapeJob`.
      if (alreadyCreatedForOrg >= PROSPECTING_MAX_JOBS_PER_ORG_PER_TICK) {
        continue;
      }

      const job = await prisma.scrapeJob.create({
        data: {
          organizationId: target.organizationId,
          sourceType: target.sourceType,
          city: target.city,
          state: target.state,
          businessType: target.businessType,
          onlyWithoutWebsite: target.onlyWithoutWebsite,
          limit: target.limit,
          status: 'QUEUED',
          actorType: 'SYSTEM',
          actorId: null,
        },
      });

      await enqueueScrapeJob(job, {
        organizationId: target.organizationId,
        scrapeJobId: job.id,
        actorType: 'SYSTEM',
      });

      await prisma.auditLog.create({
        data: {
          organizationId: target.organizationId,
          actorType: 'SYSTEM',
          actorId: null,
          action: 'scrape_job.created',
          resource: `ScrapeJob:${job.id}`,
          metadata: { trigger: 'prospecting_scan', prospectingTargetId: target.id },
        },
      });

      createdThisTickByOrg.set(target.organizationId, alreadyCreatedForOrg + 1);
      createdCount += 1;
    } catch (error) {
      Sentry.captureException(error, {
        extra: { prospectingTargetId: target.id, organizationId: target.organizationId },
      });
    }
  }

  return createdCount;
}
