import type { PrismaClient } from '@opsmind/database';
import * as Sentry from '@sentry/node';
import { withTenantContext } from './tenant-context';

/**
 * Lembrete de vencimento de tarefa (plano
 * pensando-como-empresa-com-agile-beaver.md) — roda periodicamente (ver
 * main.ts), achando `Task` OPEN/IN_PROGRESS com `dueDate` já passada e ainda
 * não notificada, e cria uma notificação in-app pro responsável
 * (`assigneeId`). `dueDateNotifiedAt` marca a tarefa como já notificada, pra
 * nunca duplicar o lembrete em ticks seguintes — `TasksService.update`
 * limpa esse campo de volta pra null quando `dueDate` muda (novo prazo
 * merece novo lembrete quando essa nova data passar).
 *
 * Mesmo racional de `scanOutreachFollowups`: ação local (uma notificação),
 * sem chamada de rede externa nem necessidade de fila — direto no scan, não
 * um par trigger/processor via BullMQ.
 */
export async function scanTaskDueReminders(prisma: PrismaClient): Promise<number> {
  const now = new Date();

  const candidates = await prisma.task.findMany({
    where: {
      status: { in: ['OPEN', 'IN_PROGRESS'] },
      dueDate: { lte: now },
      dueDateNotifiedAt: null,
      // Sem responsável, não há pra quem notificar — `Notification.userId`
      // não é opcional.
      assigneeId: { not: null },
    },
  });

  let notifiedCount = 0;

  for (const task of candidates) {
    // Try/catch por tarefa — mesmo padrão de `scanOutreachFollowups`/
    // `scanProspectingTargets`: uma falha isolada nunca aborta o resto do
    // scan, inclusive tarefas de outras organizações.
    try {
      await withTenantContext(prisma, task.organizationId, async (tx) => {
        await tx.notification.create({
          data: {
            organizationId: task.organizationId,
            userId: task.assigneeId!,
            type: 'task.due_reminder',
            payload: { taskId: task.id, title: task.title, dueDate: task.dueDate },
          },
        });
        await tx.task.update({
          where: { id: task.id },
          data: { dueDateNotifiedAt: new Date() },
        });
      });
      notifiedCount += 1;
    } catch (error) {
      Sentry.captureException(error, { extra: { taskId: task.id, organizationId: task.organizationId } });
    }
  }

  return notifiedCount;
}
