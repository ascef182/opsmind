jest.mock('./tenant-context', () => ({
  withTenantContext: jest.fn((_prisma: unknown, _orgId: string, fn: (tx: unknown) => unknown) => fn('TX')),
}));
jest.mock('@sentry/node', () => ({ captureException: jest.fn() }));

import * as Sentry from '@sentry/node';
import { scanTaskDueReminders } from './task-due-reminder-scan';

describe('scanTaskDueReminders', () => {
  function buildPrisma() {
    return { task: { findMany: jest.fn() } };
  }

  function buildTx() {
    return {
      notification: { create: jest.fn().mockResolvedValue({ id: 'notif-1' }) },
      task: { update: jest.fn().mockResolvedValue({ id: 'task-1' }) },
    };
  }

  const overdueTask = {
    id: 'task-1',
    organizationId: 'org-1',
    title: 'Ligar pro cliente',
    assigneeId: 'user-1',
    dueDate: new Date('2020-01-01'),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('busca tarefas OPEN/IN_PROGRESS vencidas, ainda não notificadas, com responsável conhecido', async () => {
    const prisma = buildPrisma();
    prisma.task.findMany.mockResolvedValue([]);

    await scanTaskDueReminders(prisma as never);

    const call = prisma.task.findMany.mock.calls[0][0];
    expect(call.where.status).toEqual({ in: ['OPEN', 'IN_PROGRESS'] });
    expect(call.where.dueDate.lte).toBeInstanceOf(Date);
    expect(call.where.dueDateNotifiedAt).toBeNull();
    expect(call.where.assigneeId).toEqual({ not: null });
  });

  it('cria a notificação pro responsável e marca dueDateNotifiedAt, numa única transação com tenant context', async () => {
    const prisma = buildPrisma();
    const tx = buildTx();
    const { withTenantContext } = jest.requireMock('./tenant-context');
    withTenantContext.mockImplementation((_p: unknown, orgId: string, fn: (tx: unknown) => unknown) => {
      expect(orgId).toBe('org-1');
      return fn(tx);
    });
    prisma.task.findMany.mockResolvedValue([overdueTask]);

    const count = await scanTaskDueReminders(prisma as never);

    expect(tx.notification.create).toHaveBeenCalledWith({
      data: {
        organizationId: 'org-1',
        userId: 'user-1',
        type: 'task.due_reminder',
        payload: { taskId: 'task-1', title: 'Ligar pro cliente', dueDate: overdueTask.dueDate },
      },
    });
    expect(tx.task.update).toHaveBeenCalledWith({
      where: { id: 'task-1' },
      data: { dueDateNotifiedAt: expect.any(Date) },
    });
    expect(count).toBe(1);
  });

  it('uma falha isolada não aborta o scan — captura no Sentry e continua', async () => {
    const prisma = buildPrisma();
    const { withTenantContext } = jest.requireMock('./tenant-context');
    withTenantContext
      .mockImplementationOnce(() => {
        throw new Error('db error');
      })
      .mockImplementationOnce((_p: unknown, _o: string, fn: (tx: unknown) => unknown) => fn(buildTx()));
    prisma.task.findMany.mockResolvedValue([overdueTask, { ...overdueTask, id: 'task-2', organizationId: 'org-2' }]);

    const count = await scanTaskDueReminders(prisma as never);

    expect(Sentry.captureException).toHaveBeenCalled();
    expect(count).toBe(1);
  });
});
