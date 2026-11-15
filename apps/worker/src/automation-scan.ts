import type { PrismaClient } from '@opsmind/database';
import {
  computeDealRisk,
  DEFAULT_EXPECTED_STAGE_DURATION_HOURS,
  type AutomationExecutionJobData,
  type DealStage,
} from '@opsmind/shared-types';

interface CustomerInactiveConditions {
  inactiveForDays?: number;
}

/**
 * Trigger (PRD §10.4) — roda periodicamente (ver main.ts) achando quem
 * precisa de uma execução da automação `CUSTOMER_INACTIVE`, e enfileira um
 * job de execução (`enqueue`) por cliente pendente, nunca executa a ação
 * aqui diretamente (isso é trabalho do processor, do outro lado da fila).
 *
 * Mesma regra de negócio de CustomersService.listInactive (apps/api, Fase
 * 3) — duplicada aqui de propósito: apps/worker é um processo separado, sem
 * acesso à árvore de DI do Nest de apps/api (ver tenant-context.ts).
 */
export async function scanCustomerInactiveAutomations(
  prisma: PrismaClient,
  // Retorno intencionalmente `unknown` — o chamador real (main.ts) passa
  // `queue.add(...)`, que resolve pro Job criado, não `void`; o scan não
  // precisa (nem deve) inspecionar esse retorno.
  enqueue: (data: AutomationExecutionJobData) => Promise<unknown> | void,
): Promise<number> {
  const automations = await prisma.automation.findMany({
    where: { trigger: 'CUSTOMER_INACTIVE', enabled: true },
    include: { organization: true },
  });

  let enqueuedCount = 0;

  for (const automation of automations) {
    const conditions = automation.conditions as CustomerInactiveConditions;
    const inactiveForDays = conditions.inactiveForDays ?? automation.organization.inactiveAfterDays;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - inactiveForDays);

    const inactiveCustomers = await prisma.customer.findMany({
      where: {
        organizationId: automation.organizationId,
        deletedAt: null,
        // NULL (LEAD que nunca teve nenhuma atividade) nunca casa com "< cutoff"
        // em SQL — exclusão automática, mesmo comportamento de
        // DashboardService/CustomersService.listInactive.
        lastActivityAt: { lt: cutoff },
      },
    });

    for (const customer of inactiveCustomers) {
      // Dedup: nunca reabrir a mesma automação pro mesmo cliente enquanto
      // nada de novo aconteceu — só dispara de novo se a última execução com
      // sucesso for ANTERIOR à atividade mais recente do cliente (ele voltou
      // a interagir e depois ficou quieto de novo).
      const alreadyHandled = await prisma.automationRun.findFirst({
        where: {
          automationId: automation.id,
          customerId: customer.id,
          status: 'SUCCESS',
          createdAt: { gt: customer.lastActivityAt! },
        },
      });
      if (alreadyHandled) {
        continue;
      }

      await enqueue({
        organizationId: automation.organizationId,
        automationId: automation.id,
        customerId: customer.id,
        actorType: 'SYSTEM',
      });
      enqueuedCount += 1;
    }
  }

  return enqueuedCount;
}

const CLOSED_DEAL_STAGES: DealStage[] = ['WON', 'LOST'];

interface DealStageStaleConditions {
  thresholdHoursOverride?: number;
}

/**
 * Trigger DEAL_STAGE_STALE (radar de risco do funil ativo) — mesmo contrato de
 * `scanCustomerInactiveAutomations`: acha deals em AT_RISK (computeDealRisk,
 * mesma função pura usada pela API e pela UI) e enfileira um job por deal,
 * sem executar a ação aqui. Dedup por `stageEnteredAt`: só reenfileira se a
 * última execução com sucesso for anterior à entrada na etapa atual.
 */
export async function scanDealStageStaleAutomations(
  prisma: PrismaClient,
  enqueue: (data: AutomationExecutionJobData) => Promise<unknown> | void,
): Promise<number> {
  const automations = await prisma.automation.findMany({
    where: { trigger: 'DEAL_STAGE_STALE', enabled: true },
  });
  let enqueuedCount = 0;
  const now = new Date();

  for (const automation of automations) {
    const conditions = automation.conditions as DealStageStaleConditions;
    const openDeals = await prisma.deal.findMany({
      where: {
        organizationId: automation.organizationId,
        deletedAt: null,
        stage: { notIn: CLOSED_DEAL_STAGES },
        // Cliente soft-deletado nunca pode gerar execução — mesma exclusão
        // de `scanCustomerInactiveAutomations`. Sem isto, o processor
        // (automation-processor.ts) devolveria SKIPPED pra sempre, a cada
        // passada do scan, porque o dedup só olha `status: 'SUCCESS'`.
        customer: { deletedAt: null },
      },
    });

    for (const deal of openDeals) {
      const expectedHours = conditions.thresholdHoursOverride !== undefined
        ? { ...DEFAULT_EXPECTED_STAGE_DURATION_HOURS, [deal.stage]: conditions.thresholdHoursOverride }
        : DEFAULT_EXPECTED_STAGE_DURATION_HOURS;
      if (computeDealRisk(deal, now, expectedHours) !== 'AT_RISK') continue;

      const alreadyHandled = await prisma.automationRun.findFirst({
        where: { automationId: automation.id, dealId: deal.id, status: 'SUCCESS', createdAt: { gt: deal.stageEnteredAt } },
      });
      if (alreadyHandled) continue;

      await enqueue({
        organizationId: automation.organizationId, automationId: automation.id,
        customerId: deal.customerId, dealId: deal.id, actorType: 'SYSTEM',
      });
      enqueuedCount += 1;
    }
  }
  return enqueuedCount;
}

interface DealSilentForConditions {
  silentForDays?: number;
}
const DEFAULT_SILENT_FOR_DAYS = 7;

/**
 * Trigger DEAL_SILENT_FOR (radar de risco do funil ativo) — mesmo contrato de
 * `scanCustomerInactiveAutomations`: acha deals abertos cujo cliente está sem
 * atividade há mais que `silentForDays` (default 7) e enfileira um job por
 * deal, sem executar a ação aqui.
 *
 * Dedup usa o mesmo `referenceActivity` da condição de disparo (o mais recente
 * entre `stageEnteredAt` e `customer.lastActivityAt`): a automação só reabre
 * depois de uma nova atividade ou mudança de etapa posterior à última execução
 * com sucesso.
 */
export async function scanDealSilentForAutomations(
  prisma: PrismaClient,
  enqueue: (data: AutomationExecutionJobData) => Promise<unknown> | void,
): Promise<number> {
  const automations = await prisma.automation.findMany({
    where: { trigger: 'DEAL_SILENT_FOR', enabled: true },
  });
  let enqueuedCount = 0;

  for (const automation of automations) {
    const conditions = automation.conditions as DealSilentForConditions;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - (conditions.silentForDays ?? DEFAULT_SILENT_FOR_DAYS));

    const silentDeals = await prisma.deal.findMany({
      where: {
        organizationId: automation.organizationId,
        deletedAt: null,
        stage: { notIn: CLOSED_DEAL_STAGES },
        // Cliente soft-deletado nunca pode gerar execução — mesma exclusão
        // de `scanCustomerInactiveAutomations` (sem isto, SKIPPED pra
        // sempre no processor, a cada passada deste scan). NULL (cliente
        // sem nenhuma atividade) nunca casa com "< cutoff" em SQL — mesma
        // exclusão de CUSTOMER_INACTIVE.
        customer: { deletedAt: null, lastActivityAt: { lt: cutoff } },
      },
      include: { customer: true },
    });

    for (const deal of silentDeals) {
      // Reconfere contra o sinal MAIS RECENTE de atividade — não só
      // `customer.lastActivityAt`, mas também `deal.stageEnteredAt`: um
      // deal recém-criado (ou recém-movido de etapa) pra um cliente antigo
      // não está "parado" de verdade, só porque o cliente está quieto há
      // mais que o limiar. O pré-filtro acima (`customer.lastActivityAt`)
      // é só um corte grosseiro no SQL; esta é a reconfirmação real em JS.
      const referenceActivity =
        deal.stageEnteredAt > deal.customer.lastActivityAt! ? deal.stageEnteredAt : deal.customer.lastActivityAt!;
      if (referenceActivity >= cutoff) continue;

      const alreadyHandled = await prisma.automationRun.findFirst({
        where: {
          automationId: automation.id,
          dealId: deal.id,
          status: 'SUCCESS',
          createdAt: { gt: referenceActivity },
        },
      });
      if (alreadyHandled) continue;

      await enqueue({
        organizationId: automation.organizationId,
        automationId: automation.id,
        customerId: deal.customerId,
        dealId: deal.id,
        actorType: 'SYSTEM',
      });
      enqueuedCount += 1;
    }
  }
  return enqueuedCount;
}
