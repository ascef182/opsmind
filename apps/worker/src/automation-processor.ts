import type { AutomationRun, Prisma, PrismaClient } from '@opsmind/database';
import {
  computeDealRisk,
  DEFAULT_EXPECTED_STAGE_DURATION_HOURS,
  type AutomationExecutionJobData,
} from '@opsmind/shared-types';
import { withTenantContext } from './tenant-context';

interface CustomerInactiveConditions {
  inactiveForDays?: number;
}

interface CustomerInactiveActions {
  createTask?: boolean;
  notify?: boolean;
}

interface DealStageStaleConditions {
  thresholdHoursOverride?: number;
}

interface DealStageStaleActions {
  createTask?: boolean;
  notify?: boolean;
}

interface DealSilentForConditions {
  silentForDays?: number;
}

interface DealSilentForActions {
  createTask?: boolean;
  notify?: boolean;
}

// Mesma constante local usada por `scanDealSilentForAutomations`
// (automation-scan.ts) — duplicada de propósito, mesma convenção do resto
// deste arquivo (ver CustomerInactiveConditions acima e o comentário de
// `scanDealSilentForAutomations`).
const DEFAULT_SILENT_FOR_DAYS = 7;

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

      switch (automation.trigger) {
        case 'CUSTOMER_INACTIVE': {
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
        }

        case 'DEAL_STAGE_STALE': {
          if (!data.dealId) {
            return tx.automationRun.create({
              data: {
                organizationId: data.organizationId,
                automationId: automation.id,
                customerId: data.customerId,
                status: 'SKIPPED',
                actorType: data.actorType,
                actorId: data.actorId,
                result: { reason: 'dealId ausente no job' },
              },
            });
          }

          const deal = await tx.deal.findFirst({
            where: { id: data.dealId, organizationId: data.organizationId, deletedAt: null },
          });
          if (!deal) {
            return tx.automationRun.create({
              data: {
                organizationId: data.organizationId,
                automationId: automation.id,
                customerId: data.customerId,
                dealId: data.dealId,
                status: 'SKIPPED',
                actorType: data.actorType,
                actorId: data.actorId,
                result: { reason: 'Negócio não encontrado ou excluído' },
              },
            });
          }

          const customer = await tx.customer.findFirst({
            where: { id: deal.customerId, organizationId: data.organizationId, deletedAt: null },
          });
          if (!customer) {
            return tx.automationRun.create({
              data: {
                organizationId: data.organizationId,
                automationId: automation.id,
                customerId: deal.customerId,
                dealId: deal.id,
                status: 'SKIPPED',
                actorType: data.actorType,
                actorId: data.actorId,
                result: { reason: 'Cliente do negócio não encontrado ou excluído' },
              },
            });
          }

          // Reconfirma a condição no momento da execução — mesmo cálculo de
          // override que `scanDealStageStaleAutomations` (automation-scan.ts),
          // nunca confia cegamente no scan.
          const conditions = automation.conditions as DealStageStaleConditions;
          const expectedHours = conditions.thresholdHoursOverride !== undefined
            ? { ...DEFAULT_EXPECTED_STAGE_DURATION_HOURS, [deal.stage]: conditions.thresholdHoursOverride }
            : DEFAULT_EXPECTED_STAGE_DURATION_HOURS;
          const stillAtRisk = computeDealRisk(deal, new Date(), expectedHours) === 'AT_RISK';

          if (!stillAtRisk) {
            return tx.automationRun.create({
              data: {
                organizationId: data.organizationId,
                automationId: automation.id,
                customerId: deal.customerId,
                dealId: deal.id,
                status: 'SKIPPED',
                actorType: data.actorType,
                actorId: data.actorId,
                result: { reason: 'Condição não bate mais desde o agendamento do job' },
              },
            });
          }

          const actions = automation.actions as DealStageStaleActions;
          const result: Record<string, string> = { dealTitle: deal.title };

          if (actions.createTask) {
            const task = await tx.task.create({
              data: {
                organizationId: data.organizationId,
                customerId: deal.customerId,
                title: `Reativar negócio "${deal.title}"`,
                description: `Negócio parado na etapa ${deal.stage} além do tempo esperado.`,
                actorType: 'AUTOMATION',
                actorId: automation.id,
              },
            });
            result.taskId = task.id;
          }

          if (actions.notify && deal.ownerUserId) {
            const notification = await tx.notification.create({
              data: {
                organizationId: data.organizationId,
                userId: deal.ownerUserId,
                type: 'automation.deal_stage_stale',
                payload: { dealId: deal.id, dealTitle: deal.title, automationId: automation.id },
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
              metadata: { dealId: deal.id, customerId: deal.customerId, ...result },
            },
          });

          return tx.automationRun.create({
            data: {
              organizationId: data.organizationId,
              automationId: automation.id,
              customerId: deal.customerId,
              dealId: deal.id,
              status: 'SUCCESS',
              actorType: data.actorType,
              actorId: data.actorId,
              result: result as Prisma.InputJsonValue,
            },
          });
        }

        case 'DEAL_SILENT_FOR': {
          if (!data.dealId) {
            return tx.automationRun.create({
              data: {
                organizationId: data.organizationId,
                automationId: automation.id,
                customerId: data.customerId,
                status: 'SKIPPED',
                actorType: data.actorType,
                actorId: data.actorId,
                result: { reason: 'dealId ausente no job' },
              },
            });
          }

          const deal = await tx.deal.findFirst({
            where: { id: data.dealId, organizationId: data.organizationId, deletedAt: null },
          });
          if (!deal) {
            return tx.automationRun.create({
              data: {
                organizationId: data.organizationId,
                automationId: automation.id,
                customerId: data.customerId,
                dealId: data.dealId,
                status: 'SKIPPED',
                actorType: data.actorType,
                actorId: data.actorId,
                result: { reason: 'Negócio não encontrado ou excluído' },
              },
            });
          }

          const customer = await tx.customer.findFirst({
            where: { id: deal.customerId, organizationId: data.organizationId, deletedAt: null },
          });
          if (!customer) {
            return tx.automationRun.create({
              data: {
                organizationId: data.organizationId,
                automationId: automation.id,
                customerId: deal.customerId,
                dealId: deal.id,
                status: 'SKIPPED',
                actorType: data.actorType,
                actorId: data.actorId,
                result: { reason: 'Cliente do negócio não encontrado ou excluído' },
              },
            });
          }

          // Reconfirma a condição no momento da execução — mesmo cálculo de
          // cutoff que `scanDealSilentForAutomations` (automation-scan.ts),
          // nunca confia cegamente no scan. Reconfere também o estágio: o
          // scan só enfileira deals abertos (`stage: { notIn: [WON, LOST] }`),
          // mas o deal pode ter virado WON/LOST entre o enfileiramento e esta
          // execução (fila atrasada/retry) — sem isto, um deal já
          // fechado/ganho continuaria gerando tarefa de reativação. Mesma
          // proteção que `DEAL_STAGE_STALE` já tem de graça via
          // `computeDealRisk` (que retorna NOT_APPLICABLE para WON/LOST).
          const dealStillOpen = deal.stage !== 'WON' && deal.stage !== 'LOST';
          const conditions = automation.conditions as DealSilentForConditions;
          const cutoff = new Date();
          cutoff.setDate(cutoff.getDate() - (conditions.silentForDays ?? DEFAULT_SILENT_FOR_DAYS));
          // Mesma reconfirmação de `scanDealSilentForAutomations`
          // (automation-scan.ts): o sinal de "parado" é o MAIS RECENTE
          // entre `customer.lastActivityAt` e `deal.stageEnteredAt` — um
          // deal recém-criado/recém-movido pra um cliente antigo não está
          // parado de verdade só porque o cliente está quieto há mais que
          // o limiar.
          const referenceActivity =
            customer.lastActivityAt !== null && deal.stageEnteredAt > customer.lastActivityAt
              ? deal.stageEnteredAt
              : customer.lastActivityAt;
          const stillSilent = dealStillOpen && referenceActivity !== null && referenceActivity < cutoff;

          if (!stillSilent) {
            return tx.automationRun.create({
              data: {
                organizationId: data.organizationId,
                automationId: automation.id,
                customerId: deal.customerId,
                dealId: deal.id,
                status: 'SKIPPED',
                actorType: data.actorType,
                actorId: data.actorId,
                result: { reason: 'Condição não bate mais desde o agendamento do job' },
              },
            });
          }

          const actions = automation.actions as DealSilentForActions;
          const result: Record<string, string> = { dealTitle: deal.title };

          if (actions.createTask) {
            const daysSilent = Math.floor(
              (Date.now() - customer.lastActivityAt!.getTime()) / (1000 * 60 * 60 * 24),
            );
            const task = await tx.task.create({
              data: {
                organizationId: data.organizationId,
                customerId: deal.customerId,
                title: `Reativar negócio "${deal.title}"`,
                description: `Cliente sem atividade há ${daysSilent} dias.`,
                actorType: 'AUTOMATION',
                actorId: automation.id,
              },
            });
            result.taskId = task.id;
          }

          if (actions.notify && deal.ownerUserId) {
            const notification = await tx.notification.create({
              data: {
                organizationId: data.organizationId,
                userId: deal.ownerUserId,
                type: 'automation.deal_silent_for',
                payload: { dealId: deal.id, dealTitle: deal.title, automationId: automation.id },
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
              metadata: { dealId: deal.id, customerId: deal.customerId, ...result },
            },
          });

          return tx.automationRun.create({
            data: {
              organizationId: data.organizationId,
              automationId: automation.id,
              customerId: deal.customerId,
              dealId: deal.id,
              status: 'SUCCESS',
              actorType: data.actorType,
              actorId: data.actorId,
              result: result as Prisma.InputJsonValue,
            },
          });
        }
      }
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
        dealId: data.dealId,
        status: 'FAILED',
        actorType: data.actorType,
        actorId: data.actorId,
        errorMessage,
      },
    });
  }
}
