jest.mock('./tenant-context', () => ({
  withTenantContext: jest.fn((_prisma: unknown, _orgId: string, fn: (tx: unknown) => unknown) => fn('TX')),
}));

import { processAutomationJob } from './automation-processor';

describe('processAutomationJob', () => {
  const jobData = {
    organizationId: 'org-1',
    automationId: 'auto-1',
    customerId: 'cust-1',
    actorType: 'SYSTEM' as const,
  };

  function buildTx() {
    return {
      automation: { findFirst: jest.fn() },
      customer: { findFirst: jest.fn() },
      organization: { findUniqueOrThrow: jest.fn() },
      task: { create: jest.fn() },
      notification: { create: jest.fn() },
      auditLog: { create: jest.fn() },
      automationRun: { create: jest.fn() },
    };
  }

  const inactiveCustomer = {
    id: 'cust-1',
    name: 'Acme',
    ownerUserId: 'user-owner',
    lastActivityAt: new Date('2020-01-01'),
  };
  const enabledAutomation = {
    id: 'auto-1',
    organizationId: 'org-1',
    conditions: {},
    actions: { createTask: true, notify: true },
  };
  const organization = { inactiveAfterDays: 14 };

  it('executa createTask e notify, e registra AutomationRun SUCCESS', async () => {
    const tx = buildTx();
    tx.automation.findFirst.mockResolvedValue(enabledAutomation);
    tx.customer.findFirst.mockResolvedValue(inactiveCustomer);
    tx.organization.findUniqueOrThrow.mockResolvedValue(organization);
    tx.task.create.mockResolvedValue({ id: 'task-1' });
    tx.notification.create.mockResolvedValue({ id: 'notif-1' });
    tx.automationRun.create.mockResolvedValue({ id: 'run-1', status: 'SUCCESS' });
    const { withTenantContext } = jest.requireMock('./tenant-context');
    withTenantContext.mockImplementation((_p: unknown, _o: string, fn: (tx: unknown) => unknown) => fn(tx));

    const run = await processAutomationJob({} as never, jobData);

    expect(tx.task.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: 'org-1',
        customerId: 'cust-1',
        title: 'Retomar contato com Acme',
        actorType: 'AUTOMATION',
        actorId: 'auto-1',
      }),
    });
    expect(tx.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: 'org-1',
        userId: 'user-owner',
        type: 'automation.customer_inactive',
      }),
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ actorType: 'AUTOMATION', actorId: 'auto-1', action: 'automation.executed' }),
      }),
    );
    expect(tx.automationRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: 'org-1',
        automationId: 'auto-1',
        customerId: 'cust-1',
        status: 'SUCCESS',
        actorType: 'SYSTEM',
        result: expect.objectContaining({ taskId: 'task-1', notificationId: 'notif-1' }),
      }),
    });
    expect(run).toEqual({ id: 'run-1', status: 'SUCCESS' });
  });

  it('pula a notificação (sem falhar) quando o cliente não tem owner', async () => {
    const tx = buildTx();
    tx.automation.findFirst.mockResolvedValue(enabledAutomation);
    tx.customer.findFirst.mockResolvedValue({ ...inactiveCustomer, ownerUserId: null });
    tx.organization.findUniqueOrThrow.mockResolvedValue(organization);
    tx.task.create.mockResolvedValue({ id: 'task-1' });
    tx.automationRun.create.mockResolvedValue({ id: 'run-1', status: 'SUCCESS' });
    const { withTenantContext } = jest.requireMock('./tenant-context');
    withTenantContext.mockImplementation((_p: unknown, _o: string, fn: (tx: unknown) => unknown) => fn(tx));

    await processAutomationJob({} as never, jobData);

    expect(tx.notification.create).not.toHaveBeenCalled();
  });

  it('marca SKIPPED quando o cliente já teve atividade nova desde o scan (condição não bate mais)', async () => {
    const tx = buildTx();
    tx.automation.findFirst.mockResolvedValue(enabledAutomation);
    tx.customer.findFirst.mockResolvedValue({ ...inactiveCustomer, lastActivityAt: new Date() });
    tx.organization.findUniqueOrThrow.mockResolvedValue(organization);
    tx.automationRun.create.mockResolvedValue({ id: 'run-1', status: 'SKIPPED' });
    const { withTenantContext } = jest.requireMock('./tenant-context');
    withTenantContext.mockImplementation((_p: unknown, _o: string, fn: (tx: unknown) => unknown) => fn(tx));

    await processAutomationJob({} as never, jobData);

    expect(tx.task.create).not.toHaveBeenCalled();
    expect(tx.automationRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'SKIPPED' }),
    });
  });

  it('marca SKIPPED quando a automação foi desabilitada/removida entre o scan e a execução', async () => {
    const tx = buildTx();
    tx.automation.findFirst.mockResolvedValue(null);
    tx.automationRun.create.mockResolvedValue({ id: 'run-1', status: 'SKIPPED' });
    const { withTenantContext } = jest.requireMock('./tenant-context');
    withTenantContext.mockImplementation((_p: unknown, _o: string, fn: (tx: unknown) => unknown) => fn(tx));

    await processAutomationJob({} as never, jobData);

    expect(tx.customer.findFirst).not.toHaveBeenCalled();
    expect(tx.automationRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'SKIPPED' }),
    });
  });

  it('registra AutomationRun FAILED (via prisma direto, não via tx já revertida) quando a transação lança', async () => {
    const { withTenantContext } = jest.requireMock('./tenant-context');
    withTenantContext.mockRejectedValue(new Error('conexão perdida'));
    const prisma = { automationRun: { create: jest.fn().mockResolvedValue({ id: 'run-1', status: 'FAILED' }) } };

    const run = await processAutomationJob(prisma as never, jobData);

    expect(prisma.automationRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'FAILED', errorMessage: 'conexão perdida' }),
    });
    expect(run).toEqual({ id: 'run-1', status: 'FAILED' });
  });
});
