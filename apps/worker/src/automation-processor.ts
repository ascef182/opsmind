import type { AutomationRun, Prisma, PrismaClient } from '@opsmind/database';
import type { AutomationExecutionJobData } from '@opsmind/shared-types';
import { withTenantContext } from './tenant-context';

interface CustomerInactiveConditions {
  inactiveForDays?: number;
}

interface CustomerInactiveActions {
  createTask?: boolean;
  notify?: boolean;
}

/**
 * Action + log (PRD §10.4) — um job por (automação, cliente), consumido da
 * fila `automation-execution`. Nunca reusa TasksService/NotificationsService
 * de apps/api diretamente: este processo não tem a árvore de DI do Nest, e
 * duplicar essas ~10 linhas de `prisma.create` é mais simples e mais
 * verdadeiramente independente (PRD §10.1: "o worker de IA/documentos
 * precisar escalar independente do resto") do que reconstruir esse grafo
 * manualmente aqui.
 *
 * Tudo dentro de UMA transação (withTenantContext): ou a automação inteira
 * teve efeito (task + notificação + audit + run), ou nada teve — nunca uma
 * tarefa órfã sem o AutomationRun correspondente.
 */
export async function processAutomationJob(
  prisma: PrismaClient,
  data: AutomationExecutionJobData,
): Promise<AutomationRun> {
  try {
    return await withTenantContext(prisma, data.organizationId, async (tx) => {
      const automation = await tx.automation.findFirst({
        where: { id: data.automationId, organizationId: data.organizationId, enabled: true },
      });
      if (!automation) {
        return tx.automationRun.create({
          data: {
            organizationId: data.organizationId,
            automationId: data.automationId,
            customerId: data.customerId,
            status: 'SKIPPED',
            actorType: data.actorType,
            actorId: data.actorId,
            result: { reason: 'Automação não encontrada, desabilitada ou removida' },
          },
        });
      }

      const customer = await tx.customer.findFirst({
        where: { id: data.customerId, organizationId: data.organizationId, deletedAt: null },
      });
      if (!customer) {
        return tx.automationRun.create({
          data: {
            organizationId: data.organizationId,
            automationId: automation.id,
            customerId: data.customerId,
            status: 'SKIPPED',
            actorType: data.actorType,
            actorId: data.actorId,
            result: { reason: 'Cliente não encontrado ou excluído' },
          },
        });
      }

      // Reconfirma a condição no momento da execução — pode ter deixado de
      // valer entre o scan (que enfileirou) e agora (ex.: alguém registrou
      // uma atividade nova nesse meio-tempo). Nunca confia cegamente no scan.
      const conditions = automation.conditions as CustomerInactiveConditions;
      const organization = await tx.organization.findUniqueOrThrow({
        where: { id: data.organizationId },
      });
      const inactiveForDays = conditions.inactiveForDays ?? organization.inactiveAfterDays;
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - inactiveForDays);
      const stillInactive = customer.lastActivityAt !== null && customer.lastActivityAt < cutoff;

      if (!stillInactive) {
        return tx.automationRun.create({
          data: {
            organizationId: data.organizationId,
            automationId: automation.id,
            customerId: customer.id,
            status: 'SKIPPED',
            actorType: data.actorType,
            actorId: data.actorId,
            result: { reason: 'Cliente teve atividade nova desde o agendamento do job' },
          },
        });
      }

      const actions = automation.actions as CustomerInactiveActions;
      const result: Record<string, string> = { customerName: customer.name };

      if (actions.createTask) {
        const task = await tx.task.create({
          data: {
            organizationId: data.organizationId,
            customerId: customer.id,
            title: `Retomar contato com ${customer.name}`,
            // actorId é o id da PRÓPRIA automação, não de um usuário — não
            // há um humano "por trás" desta ação específica (diferente do
            // actorType/actorId do AutomationRun, que registra quem/o que
            // DISPAROU a execução: SYSTEM no scan, ou USER num "run" manual).
            actorType: 'AUTOMATION',
            actorId: automation.id,
          },
        });
        result.taskId = task.id;
      }

      if (actions.notify && customer.ownerUserId) {
        const notification = await tx.notification.create({
          data: {
            organizationId: data.organizationId,
            userId: customer.ownerUserId,
            type: 'automation.customer_inactive',
            payload: { customerId: customer.id, customerName: customer.name, automationId: automation.id },
          },
        });
        result.notificationId = notification.id;
      }

      await tx.auditLog.create({
        data: {
          organizationId: data.organizationId,
          actorType: 'AUTOMATION',
          actorId: automation.id,
          action: 'automation.executed',
          resource: `Automation:${automation.id}`,
          metadata: { customerId: customer.id, ...result },
        },
      });

      return tx.automationRun.create({
        data: {
          organizationId: data.organizationId,
          automationId: automation.id,
          customerId: customer.id,
          status: 'SUCCESS',
          actorType: data.actorType,
          actorId: data.actorId,
          result: result as Prisma.InputJsonValue,
        },
      });
    });
  } catch (error) {
    // A transação acima já reverteu (nenhuma task/notificação/audit órfã) —
    // o registro de FAILED é escrito à parte, fora dela, via `prisma` direto.
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    return prisma.automationRun.create({
      data: {
        organizationId: data.organizationId,
        automationId: data.automationId,
        customerId: data.customerId,
        status: 'FAILED',
        actorType: data.actorType,
        actorId: data.actorId,
        errorMessage,
      },
    });
  }
}
