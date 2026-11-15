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
    trigger: 'CUSTOMER_INACTIVE',
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

describe('processAutomationJob — DEAL_STAGE_STALE', () => {
  const jobData = { organizationId: 'org-1', automationId: 'auto-1', customerId: 'cust-1', dealId: 'deal-1', actorType: 'SYSTEM' as const };
  const staleAutomation = { id: 'auto-1', organizationId: 'org-1', trigger: 'DEAL_STAGE_STALE', conditions: {}, actions: { createTask: true, notify: true } };
  const staleDeal = { id: 'deal-1', customerId: 'cust-1', title: 'Contrato X', stage: 'QUALIFICATION', stageEnteredAt: new Date('2000-01-01'), ownerUserId: 'user-owner' };
  const customer = { id: 'cust-1', name: 'Acme' };

  function buildTx() {
    return {
      automation: { findFirst: jest.fn() }, deal: { findFirst: jest.fn() }, customer: { findFirst: jest.fn() },
      task: { create: jest.fn() }, notification: { create: jest.fn() }, auditLog: { create: jest.fn() }, automationRun: { create: jest.fn() },
    };
  }

  it('cria task + notificação e registra AutomationRun SUCCESS com dealId quando o deal ainda está AT_RISK', async () => {
    const tx = buildTx();
    tx.automation.findFirst.mockResolvedValue(staleAutomation);
    tx.deal.findFirst.mockResolvedValue(staleDeal);
    tx.customer.findFirst.mockResolvedValue(customer);
    tx.task.create.mockResolvedValue({ id: 'task-1' });
    tx.notification.create.mockResolvedValue({ id: 'notif-1' });
    tx.automationRun.create.mockResolvedValue({ id: 'run-1', status: 'SUCCESS' });
    const { withTenantContext } = jest.requireMock('./tenant-context');
    withTenantContext.mockImplementation((_p: unknown, _o: string, fn: (tx: unknown) => unknown) => fn(tx));

    await processAutomationJob({} as never, jobData);

    expect(tx.task.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ organizationId: 'org-1', customerId: 'cust-1', actorType: 'AUTOMATION', actorId: 'auto-1' }),
    });
    expect(tx.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'user-owner', type: 'automation.deal_stage_stale' }),
    });
    expect(tx.automationRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ dealId: 'deal-1', customerId: 'cust-1', status: 'SUCCESS' }),
    });
  });

  it('marca SKIPPED sem criar task quando o deal já não está mais AT_RISK (mudou de etapa entre o scan e a execução)', async () => {
    const tx = buildTx();
    tx.automation.findFirst.mockResolvedValue(staleAutomation);
    tx.deal.findFirst.mockResolvedValue({ ...staleDeal, stageEnteredAt: new Date() });
    tx.customer.findFirst.mockResolvedValue(customer);
    tx.automationRun.create.mockResolvedValue({ id: 'run-1', status: 'SKIPPED' });
    const { withTenantContext } = jest.requireMock('./tenant-context');
    withTenantContext.mockImplementation((_p: unknown, _o: string, fn: (tx: unknown) => unknown) => fn(tx));

    await processAutomationJob({} as never, jobData);

    expect(tx.task.create).not.toHaveBeenCalled();
    expect(tx.automationRun.create).toHaveBeenCalledWith({ data: expect.objectContaining({ status: 'SKIPPED' }) });
  });

  it('pula a notificação (sem falhar) quando o deal não tem ownerUserId', async () => {
    const tx = buildTx();
    tx.automation.findFirst.mockResolvedValue(staleAutomation);
    tx.deal.findFirst.mockResolvedValue({ ...staleDeal, ownerUserId: null });
    tx.customer.findFirst.mockResolvedValue(customer);
    tx.task.create.mockResolvedValue({ id: 'task-1' });
    tx.automationRun.create.mockResolvedValue({ id: 'run-1', status: 'SUCCESS' });
    const { withTenantContext } = jest.requireMock('./tenant-context');
    withTenantContext.mockImplementation((_p: unknown, _o: string, fn: (tx: unknown) => unknown) => fn(tx));

    await processAutomationJob({} as never, jobData);

    expect(tx.notification.create).not.toHaveBeenCalled();
  });

  it('marca SKIPPED sem criar task quando o deal já foi fechado (WON/LOST) entre o scan e a execução', async () => {
    const tx = buildTx();
    tx.automation.findFirst.mockResolvedValue(staleAutomation);
    tx.deal.findFirst.mockResolvedValue({ ...staleDeal, stage: 'WON' });
    tx.customer.findFirst.mockResolvedValue(customer);
    tx.automationRun.create.mockResolvedValue({ id: 'run-1', status: 'SKIPPED' });
    const { withTenantContext } = jest.requireMock('./tenant-context');
    withTenantContext.mockImplementation((_p: unknown, _o: string, fn: (tx: unknown) => unknown) => fn(tx));

    await processAutomationJob({} as never, jobData);

    expect(tx.task.create).not.toHaveBeenCalled();
    expect(tx.automationRun.create).toHaveBeenCalledWith({ data: expect.objectContaining({ status: 'SKIPPED' }) });
  });
});

describe('processAutomationJob — DEAL_SILENT_FOR', () => {
  const jobData = { organizationId: 'org-1', automationId: 'auto-2', customerId: 'cust-1', dealId: 'deal-1', actorType: 'SYSTEM' as const };
  const silentAutomation = { id: 'auto-2', organizationId: 'org-1', trigger: 'DEAL_SILENT_FOR', conditions: {}, actions: { createTask: true, notify: false } };
  const silentDeal = { id: 'deal-1', customerId: 'cust-1', title: 'Contrato Y', stage: 'NEGOTIATION', ownerUserId: null };

  function buildTx() {
    return {
      automation: { findFirst: jest.fn() }, deal: { findFirst: jest.fn() }, customer: { findFirst: jest.fn() },
      task: { create: jest.fn() }, notification: { create: jest.fn() }, auditLog: { create: jest.fn() }, automationRun: { create: jest.fn() },
    };
  }

  it('cria task quando o cliente do deal ainda está quieto há mais que o limiar', async () => {
    const tx = buildTx();
    tx.automation.findFirst.mockResolvedValue(silentAutomation);
    tx.deal.findFirst.mockResolvedValue(silentDeal);
    tx.customer.findFirst.mockResolvedValue({ id: 'cust-1', name: 'Beta', lastActivityAt: new Date('2000-01-01') });
    tx.task.create.mockResolvedValue({ id: 'task-1' });
    tx.automationRun.create.mockResolvedValue({ id: 'run-1', status: 'SUCCESS' });
    const { withTenantContext } = jest.requireMock('./tenant-context');
    withTenantContext.mockImplementation((_p: unknown, _o: string, fn: (tx: unknown) => unknown) => fn(tx));

    await processAutomationJob({} as never, jobData);

    expect(tx.task.create).toHaveBeenCalled();
  });

  it('marca SKIPPED quando o cliente teve atividade nova desde o agendamento do job', async () => {
    const tx = buildTx();
    tx.automation.findFirst.mockResolvedValue(silentAutomation);
    tx.deal.findFirst.mockResolvedValue(silentDeal);
    tx.customer.findFirst.mockResolvedValue({ id: 'cust-1', name: 'Beta', lastActivityAt: new Date() });
    tx.automationRun.create.mockResolvedValue({ id: 'run-1', status: 'SKIPPED' });
    const { withTenantContext } = jest.requireMock('./tenant-context');
    withTenantContext.mockImplementation((_p: unknown, _o: string, fn: (tx: unknown) => unknown) => fn(tx));

    await processAutomationJob({} as never, jobData);

    expect(tx.task.create).not.toHaveBeenCalled();
  });

  it('marca SKIPPED sem criar task quando o deal já foi fechado (WON/LOST) entre o scan e a execução, mesmo com o cliente ainda quieto', async () => {
    const tx = buildTx();
    tx.automation.findFirst.mockResolvedValue(silentAutomation);
    tx.deal.findFirst.mockResolvedValue({ ...silentDeal, stage: 'LOST' });
    tx.customer.findFirst.mockResolvedValue({ id: 'cust-1', name: 'Beta', lastActivityAt: new Date('2000-01-01') });
    tx.automationRun.create.mockResolvedValue({ id: 'run-1', status: 'SKIPPED' });
    const { withTenantContext } = jest.requireMock('./tenant-context');
    withTenantContext.mockImplementation((_p: unknown, _o: string, fn: (tx: unknown) => unknown) => fn(tx));

    await processAutomationJob({} as never, jobData);

    expect(tx.task.create).not.toHaveBeenCalled();
    expect(tx.automationRun.create).toHaveBeenCalledWith({ data: expect.objectContaining({ status: 'SKIPPED' }) });
  });

  it('marca SKIPPED quando o deal entrou na etapa atual recentemente, mesmo com o cliente quieto há mais que o limiar (stageEnteredAt é o sinal mais recente)', async () => {
    const tx = buildTx();
    tx.automation.findFirst.mockResolvedValue(silentAutomation);
    tx.deal.findFirst.mockResolvedValue({ ...silentDeal, stageEnteredAt: new Date() });
    tx.customer.findFirst.mockResolvedValue({ id: 'cust-1', name: 'Beta', lastActivityAt: new Date('2000-01-01') });
    tx.automationRun.create.mockResolvedValue({ id: 'run-1', status: 'SKIPPED' });
    const { withTenantContext } = jest.requireMock('./tenant-context');
    withTenantContext.mockImplementation((_p: unknown, _o: string, fn: (tx: unknown) => unknown) => fn(tx));

    await processAutomationJob({} as never, jobData);

    expect(tx.task.create).not.toHaveBeenCalled();
    expect(tx.automationRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'SKIPPED', result: { reason: 'Condição não bate mais desde o agendamento do job' } }),
    });
  });
});

describe.each(['DEAL_STAGE_STALE', 'DEAL_SILENT_FOR'] as const)('processAutomationJob — guards de %s', (trigger) => {
  const jobDataNoDealId = { organizationId: 'org-1', automationId: 'auto-1', customerId: 'cust-1', actorType: 'SYSTEM' as const };
  const automation = { id: 'auto-1', organizationId: 'org-1', trigger, conditions: {}, actions: { createTask: true } };

  function buildTx() {
    return {
      automation: { findFirst: jest.fn() }, deal: { findFirst: jest.fn() }, customer: { findFirst: jest.fn() },
      task: { create: jest.fn() }, notification: { create: jest.fn() }, auditLog: { create: jest.fn() }, automationRun: { create: jest.fn() },
    };
  }

  function mockWithTenantContext(tx: ReturnType<typeof buildTx>) {
    const { withTenantContext } = jest.requireMock('./tenant-context');
    withTenantContext.mockImplementation((_p: unknown, _o: string, fn: (tx: unknown) => unknown) => fn(tx));
  }

  it('marca SKIPPED "dealId ausente no job" quando data.dealId está ausente', async () => {
    const tx = buildTx();
    tx.automation.findFirst.mockResolvedValue(automation);
    tx.automationRun.create.mockResolvedValue({ id: 'run-1', status: 'SKIPPED' });
    mockWithTenantContext(tx);

    await processAutomationJob({} as never, jobDataNoDealId);

    expect(tx.deal.findFirst).not.toHaveBeenCalled();
    expect(tx.automationRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'SKIPPED', result: { reason: 'dealId ausente no job' } }),
    });
  });

  it('marca SKIPPED "Negócio não encontrado ou excluído" quando o deal não existe', async () => {
    const tx = buildTx();
    tx.automation.findFirst.mockResolvedValue(automation);
    tx.deal.findFirst.mockResolvedValue(null);
    tx.automationRun.create.mockResolvedValue({ id: 'run-1', status: 'SKIPPED' });
    mockWithTenantContext(tx);

    await processAutomationJob({} as never, { ...jobDataNoDealId, dealId: 'deal-x' });

    expect(tx.customer.findFirst).not.toHaveBeenCalled();
    expect(tx.automationRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'SKIPPED', result: { reason: 'Negócio não encontrado ou excluído' } }),
    });
  });

  it('marca SKIPPED "Cliente do negócio não encontrado ou excluído" quando o customer do deal não existe', async () => {
    const tx = buildTx();
    tx.automation.findFirst.mockResolvedValue(automation);
    tx.deal.findFirst.mockResolvedValue({ id: 'deal-1', customerId: 'cust-1', stage: 'QUALIFICATION', stageEnteredAt: new Date(), ownerUserId: null, title: 'X' });
    tx.customer.findFirst.mockResolvedValue(null);
    tx.automationRun.create.mockResolvedValue({ id: 'run-1', status: 'SKIPPED' });
    mockWithTenantContext(tx);

    await processAutomationJob({} as never, { ...jobDataNoDealId, dealId: 'deal-1' });

    expect(tx.automationRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'SKIPPED', result: { reason: 'Cliente do negócio não encontrado ou excluído' } }),
    });
  });
});

describe('processAutomationJob — FAILED preserva dealId', () => {
  it('grava dealId no AutomationRun FAILED quando o job é de um trigger de Deal e algo lança', async () => {
    const prisma = { automationRun: { create: jest.fn().mockResolvedValue({ id: 'run-1', status: 'FAILED' }) } };
    const { withTenantContext } = jest.requireMock('./tenant-context');
    withTenantContext.mockImplementation(() => { throw new Error('falha simulada'); });

    const jobData = { organizationId: 'org-1', automationId: 'auto-1', customerId: 'cust-1', dealId: 'deal-1', actorType: 'SYSTEM' as const };
    await processAutomationJob(prisma as never, jobData);

    expect(prisma.automationRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'FAILED', dealId: 'deal-1' }),
    });
  });
});
