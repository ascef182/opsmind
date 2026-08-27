import type { PrismaClient } from '@opsmind/database';
import type { AutomationExecutionJobData } from '@opsmind/shared-types';

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
