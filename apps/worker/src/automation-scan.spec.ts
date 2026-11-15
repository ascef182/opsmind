jest.mock('@sentry/node', () => ({ captureException: jest.fn() }));

import * as Sentry from '@sentry/node';
import {
  scanCustomerInactiveAutomations,
  scanDealSilentForAutomations,
  scanDealStageStaleAutomations,
} from './automation-scan';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('scanCustomerInactiveAutomations', () => {
  function buildPrisma() {
    return {
      automation: { findMany: jest.fn() },
      customer: { findMany: jest.fn() },
      automationRun: { findFirst: jest.fn() },
    };
  }

  it('enfileira um job por cliente inativo de uma automação habilitada, usando inactiveAfterDays da organização por padrão', async () => {
    const prisma = buildPrisma();
    prisma.automation.findMany.mockResolvedValue([
      {
        id: 'auto-1',
        organizationId: 'org-1',
        conditions: {},
        organization: { inactiveAfterDays: 14 },
      },
    ]);
    const inactiveCustomer = { id: 'cust-1', name: 'Acme', lastActivityAt: new Date('2020-01-01') };
    prisma.customer.findMany.mockResolvedValue([inactiveCustomer]);
    prisma.automationRun.findFirst.mockResolvedValue(null);
    const enqueue = jest.fn();

    const count = await scanCustomerInactiveAutomations(prisma as never, enqueue);

    expect(prisma.automation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { trigger: 'CUSTOMER_INACTIVE', enabled: true },
      }),
    );
    expect(prisma.customer.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-1',
        deletedAt: null,
        lastActivityAt: { lt: expect.any(Date) },
      },
    });
    expect(enqueue).toHaveBeenCalledWith({
      organizationId: 'org-1',
      automationId: 'auto-1',
      customerId: 'cust-1',
      actorType: 'SYSTEM',
    });
    expect(count).toBe(1);
  });

  it('usa conditions.inactiveForDays da automação em vez do padrão da organização, quando configurado', async () => {
    const prisma = buildPrisma();
    prisma.automation.findMany.mockResolvedValue([
      {
        id: 'auto-1',
        organizationId: 'org-1',
        conditions: { inactiveForDays: 30 },
        organization: { inactiveAfterDays: 14 },
      },
    ]);
    prisma.customer.findMany.mockResolvedValue([]);

    await scanCustomerInactiveAutomations(prisma as never, jest.fn());

    const cutoffUsed = prisma.customer.findMany.mock.calls[0][0].where.lastActivityAt.lt as Date;
    const expectedCutoff = new Date();
    expectedCutoff.setDate(expectedCutoff.getDate() - 30);
    // Tolerância de alguns segundos (o teste e o código rodam em momentos
    // ligeiramente diferentes de `new Date()`).
    expect(Math.abs(cutoffUsed.getTime() - expectedCutoff.getTime())).toBeLessThan(5000);
  });

  it('não enfileira de novo um cliente já tratado com sucesso desde a última atividade dele (dedup)', async () => {
    const prisma = buildPrisma();
    prisma.automation.findMany.mockResolvedValue([
      { id: 'auto-1', organizationId: 'org-1', conditions: {}, organization: { inactiveAfterDays: 14 } },
    ]);
    prisma.customer.findMany.mockResolvedValue([
      { id: 'cust-1', name: 'Acme', lastActivityAt: new Date('2020-01-01') },
    ]);
    prisma.automationRun.findFirst.mockResolvedValue({ id: 'run-1' });
    const enqueue = jest.fn();

    const count = await scanCustomerInactiveAutomations(prisma as never, enqueue);

    expect(prisma.automationRun.findFirst).toHaveBeenCalledWith({
      where: {
        automationId: 'auto-1',
        customerId: 'cust-1',
        status: 'SUCCESS',
        createdAt: { gt: new Date('2020-01-01') },
      },
    });
    expect(enqueue).not.toHaveBeenCalled();
    expect(count).toBe(0);
  });

  it('ignora automações sem nenhum cliente inativo', async () => {
    const prisma = buildPrisma();
    prisma.automation.findMany.mockResolvedValue([
      { id: 'auto-1', organizationId: 'org-1', conditions: {}, organization: { inactiveAfterDays: 14 } },
    ]);
    prisma.customer.findMany.mockResolvedValue([]);

    const count = await scanCustomerInactiveAutomations(prisma as never, jest.fn());

    expect(count).toBe(0);
  });

  it('uma automação cujo processamento lança não aborta o scan pras demais — captura no Sentry e continua (achado I2)', async () => {
    const prisma = buildPrisma();
    prisma.automation.findMany.mockResolvedValue([
      { id: 'auto-broken', organizationId: 'org-1', conditions: {}, organization: { inactiveAfterDays: 14 } },
      { id: 'auto-2', organizationId: 'org-2', conditions: {}, organization: { inactiveAfterDays: 14 } },
    ]);
    prisma.customer.findMany
      .mockRejectedValueOnce(new Error('falha simulada na automação 1'))
      .mockResolvedValueOnce([{ id: 'cust-2', name: 'Beta', lastActivityAt: new Date('2020-01-01') }]);
    prisma.automationRun.findFirst.mockResolvedValue(null);
    const enqueue = jest.fn();

    const count = await scanCustomerInactiveAutomations(prisma as never, enqueue);

    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ extra: { automationId: 'auto-broken', organizationId: 'org-1' } }),
    );
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ automationId: 'auto-2', customerId: 'cust-2' }),
    );
    expect(count).toBe(1);
  });
});

describe('scanDealStageStaleAutomations', () => {
  function buildPrisma() {
    return {
      automation: { findMany: jest.fn() },
      deal: { findMany: jest.fn() },
      automationRun: { findFirst: jest.fn() },
    };
  }

  it('enfileira um job por deal AT_RISK de uma automação habilitada', async () => {
    const prisma = buildPrisma();
    prisma.automation.findMany.mockResolvedValue([
      { id: 'auto-1', organizationId: 'org-1', conditions: {} },
    ]);
    const staleDeal = {
      id: 'deal-1', customerId: 'cust-1', stage: 'QUALIFICATION',
      stageEnteredAt: new Date('2000-01-01'),
    };
    prisma.deal.findMany.mockResolvedValue([staleDeal]);
    prisma.automationRun.findFirst.mockResolvedValue(null);
    const enqueue = jest.fn();

    const count = await scanDealStageStaleAutomations(prisma as never, enqueue);

    expect(prisma.automation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { trigger: 'DEAL_STAGE_STALE', enabled: true } }),
    );
    expect(prisma.deal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: 'org-1', stage: { notIn: ['WON', 'LOST'] } }),
      }),
    );
    expect(enqueue).toHaveBeenCalledWith({
      organizationId: 'org-1', automationId: 'auto-1', customerId: 'cust-1', dealId: 'deal-1', actorType: 'SYSTEM',
    });
    expect(count).toBe(1);
  });

  it('não enfileira um deal cujo bucket ainda é ON_TRACK ou COOLING', async () => {
    const prisma = buildPrisma();
    prisma.automation.findMany.mockResolvedValue([{ id: 'auto-1', organizationId: 'org-1', conditions: {} }]);
    prisma.deal.findMany.mockResolvedValue([
      { id: 'deal-1', customerId: 'cust-1', stage: 'QUALIFICATION', stageEnteredAt: new Date() },
    ]);
    const enqueue = jest.fn();

    const count = await scanDealStageStaleAutomations(prisma as never, enqueue);

    expect(enqueue).not.toHaveBeenCalled();
    expect(count).toBe(0);
  });

  it('filtra deals de clientes soft-deletados na própria query (customer.deletedAt: null)', async () => {
    const prisma = buildPrisma();
    prisma.automation.findMany.mockResolvedValue([{ id: 'auto-1', organizationId: 'org-1', conditions: {} }]);
    // Simula o filtro real do Prisma: nenhum deal retornado porque o único
    // cliente está soft-deletado — a asserção abaixo é o que importa:
    // garantir que a query inclui o filtro, não o comportamento do mock.
    prisma.deal.findMany.mockResolvedValue([]);
    const enqueue = jest.fn();

    await scanDealStageStaleAutomations(prisma as never, enqueue);

    expect(prisma.deal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ customer: { deletedAt: null } }),
      }),
    );
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('usa conditions.thresholdHoursOverride em vez do default quando configurado', async () => {
    const prisma = buildPrisma();
    prisma.automation.findMany.mockResolvedValue([
      { id: 'auto-1', organizationId: 'org-1', conditions: { thresholdHoursOverride: 1 } },
    ]);
    const stageEnteredAt = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2h atrás
    prisma.deal.findMany.mockResolvedValue([
      { id: 'deal-1', customerId: 'cust-1', stage: 'QUALIFICATION', stageEnteredAt },
    ]);
    prisma.automationRun.findFirst.mockResolvedValue(null);
    const enqueue = jest.fn();

    const count = await scanDealStageStaleAutomations(prisma as never, enqueue);

    expect(enqueue).toHaveBeenCalled();
    expect(count).toBe(1);
  });

  it('não enfileira de novo um deal já tratado com sucesso desde a última mudança de etapa (dedup)', async () => {
    const prisma = buildPrisma();
    prisma.automation.findMany.mockResolvedValue([{ id: 'auto-1', organizationId: 'org-1', conditions: {} }]);
    const staleDeal = { id: 'deal-1', customerId: 'cust-1', stage: 'QUALIFICATION', stageEnteredAt: new Date('2000-01-01') };
    prisma.deal.findMany.mockResolvedValue([staleDeal]);
    prisma.automationRun.findFirst.mockResolvedValue({ id: 'run-1' });
    const enqueue = jest.fn();

    const count = await scanDealStageStaleAutomations(prisma as never, enqueue);

    expect(prisma.automationRun.findFirst).toHaveBeenCalledWith({
      where: { automationId: 'auto-1', dealId: 'deal-1', status: 'SUCCESS', createdAt: { gt: staleDeal.stageEnteredAt } },
    });
    expect(enqueue).not.toHaveBeenCalled();
    expect(count).toBe(0);
  });

  it('uma automação cujo processamento lança não aborta o scan pras demais — captura no Sentry e continua (achado I2)', async () => {
    const prisma = buildPrisma();
    prisma.automation.findMany.mockResolvedValue([
      { id: 'auto-broken', organizationId: 'org-1', conditions: {} },
      { id: 'auto-2', organizationId: 'org-2', conditions: {} },
    ]);
    const okDeal = { id: 'deal-2', customerId: 'cust-2', stage: 'QUALIFICATION', stageEnteredAt: new Date('2000-01-01') };
    prisma.deal.findMany
      .mockRejectedValueOnce(new Error('falha simulada na automação 1'))
      .mockResolvedValueOnce([okDeal]);
    prisma.automationRun.findFirst.mockResolvedValue(null);
    const enqueue = jest.fn();

    const count = await scanDealStageStaleAutomations(prisma as never, enqueue);

    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ extra: { automationId: 'auto-broken', organizationId: 'org-1' } }),
    );
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ automationId: 'auto-2', dealId: 'deal-2' }));
    expect(count).toBe(1);
  });
});

describe('scanDealSilentForAutomations', () => {
  function buildPrisma() {
    return {
      automation: { findMany: jest.fn() },
      deal: { findMany: jest.fn() },
      automationRun: { findFirst: jest.fn() },
    };
  }

  it('enfileira um job por deal aberto cujo cliente está quieto há mais que o limiar', async () => {
    const prisma = buildPrisma();
    prisma.automation.findMany.mockResolvedValue([{ id: 'auto-1', organizationId: 'org-1', conditions: {} }]);
    const lastActivityAt = new Date('2000-01-01');
    prisma.deal.findMany.mockResolvedValue([
      {
        id: 'deal-1',
        customerId: 'cust-1',
        stage: 'NEGOTIATION',
        stageEnteredAt: new Date('2000-01-01'), // deal também parado há tempo, não só o cliente
        customer: { lastActivityAt },
      },
    ]);
    prisma.automationRun.findFirst.mockResolvedValue(null);
    const enqueue = jest.fn();

    const count = await scanDealSilentForAutomations(prisma as never, enqueue);

    expect(prisma.deal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: 'org-1',
          stage: { notIn: ['WON', 'LOST'] },
          customer: { deletedAt: null, lastActivityAt: { lt: expect.any(Date) } },
        }),
        include: { customer: true },
      }),
    );
    expect(enqueue).toHaveBeenCalledWith({
      organizationId: 'org-1', automationId: 'auto-1', customerId: 'cust-1', dealId: 'deal-1', actorType: 'SYSTEM',
    });
    expect(count).toBe(1);
  });

  it('filtra deals de clientes soft-deletados na própria query (customer.deletedAt: null)', async () => {
    const prisma = buildPrisma();
    prisma.automation.findMany.mockResolvedValue([{ id: 'auto-1', organizationId: 'org-1', conditions: {} }]);
    prisma.deal.findMany.mockResolvedValue([]);
    const enqueue = jest.fn();

    await scanDealSilentForAutomations(prisma as never, enqueue);

    expect(prisma.deal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          customer: { deletedAt: null, lastActivityAt: { lt: expect.any(Date) } },
        }),
      }),
    );
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('não enfileira um deal recém-criado/recém-movido de etapa, mesmo com o cliente quieto há muito tempo (stageEnteredAt recente é o sinal mais recente)', async () => {
    const prisma = buildPrisma();
    prisma.automation.findMany.mockResolvedValue([{ id: 'auto-1', organizationId: 'org-1', conditions: {} }]);
    const lastActivityAt = new Date('2000-01-01'); // cliente quieto há anos
    prisma.deal.findMany.mockResolvedValue([
      {
        id: 'deal-1',
        customerId: 'cust-1',
        stage: 'NEGOTIATION',
        stageEnteredAt: new Date(), // deal entrou na etapa agora mesmo
        customer: { lastActivityAt },
      },
    ]);
    const enqueue = jest.fn();

    const count = await scanDealSilentForAutomations(prisma as never, enqueue);

    expect(enqueue).not.toHaveBeenCalled();
    expect(count).toBe(0);
  });

  it('usa conditions.silentForDays em vez do default (7 dias) quando configurado', async () => {
    const prisma = buildPrisma();
    prisma.automation.findMany.mockResolvedValue([
      { id: 'auto-1', organizationId: 'org-1', conditions: { silentForDays: 30 } },
    ]);
    prisma.deal.findMany.mockResolvedValue([]);

    await scanDealSilentForAutomations(prisma as never, jest.fn());

    const cutoffUsed = prisma.deal.findMany.mock.calls[0][0].where.customer.lastActivityAt.lt as Date;
    const expectedCutoff = new Date();
    expectedCutoff.setDate(expectedCutoff.getDate() - 30);
    expect(Math.abs(cutoffUsed.getTime() - expectedCutoff.getTime())).toBeLessThan(5000);
  });

  it('não enfileira de novo um deal já tratado com sucesso desde a última atividade do cliente (dedup)', async () => {
    const prisma = buildPrisma();
    prisma.automation.findMany.mockResolvedValue([{ id: 'auto-1', organizationId: 'org-1', conditions: {} }]);
    const lastActivityAt = new Date('2000-01-01');
    prisma.deal.findMany.mockResolvedValue([
      { id: 'deal-1', customerId: 'cust-1', stage: 'NEGOTIATION', customer: { lastActivityAt } },
    ]);
    prisma.automationRun.findFirst.mockResolvedValue({ id: 'run-1' });
    const enqueue = jest.fn();

    const count = await scanDealSilentForAutomations(prisma as never, enqueue);

    expect(prisma.automationRun.findFirst).toHaveBeenCalledWith({
      where: { automationId: 'auto-1', dealId: 'deal-1', status: 'SUCCESS', createdAt: { gt: lastActivityAt } },
    });
    expect(enqueue).not.toHaveBeenCalled();
    expect(count).toBe(0);
  });

  it('reabre a automação quando o deal mudou de etapa e voltou a ficar quieto, mesmo com uma execução SUCCESS anterior baseada em lastActivityAt antigo', async () => {
    const prisma = buildPrisma();
    prisma.automation.findMany.mockResolvedValue([{ id: 'auto-1', organizationId: 'org-1', conditions: {} }]);
    const lastActivityAt = new Date('2020-01-01');
    const stageEnteredAt = new Date('2020-06-01'); // depois da última atividade, mas também parado há muito tempo
    prisma.deal.findMany.mockResolvedValue([
      { id: 'deal-1', customerId: 'cust-1', stage: 'NEGOTIATION', stageEnteredAt, customer: { lastActivityAt } },
    ]);
    prisma.automationRun.findFirst.mockResolvedValue(null);
    const enqueue = jest.fn();

    const count = await scanDealSilentForAutomations(prisma as never, enqueue);

    expect(prisma.automationRun.findFirst).toHaveBeenCalledWith({
      where: { automationId: 'auto-1', dealId: 'deal-1', status: 'SUCCESS', createdAt: { gt: stageEnteredAt } },
    });
    expect(enqueue).toHaveBeenCalled();
    expect(count).toBe(1);
  });

  it('uma automação cujo processamento lança não aborta o scan pras demais — captura no Sentry e continua (achado I2)', async () => {
    const prisma = buildPrisma();
    prisma.automation.findMany.mockResolvedValue([
      { id: 'auto-broken', organizationId: 'org-1', conditions: {} },
      { id: 'auto-2', organizationId: 'org-2', conditions: {} },
    ]);
    const lastActivityAt = new Date('2000-01-01');
    const okDeal = { id: 'deal-2', customerId: 'cust-2', stage: 'NEGOTIATION', stageEnteredAt: lastActivityAt, customer: { lastActivityAt } };
    prisma.deal.findMany
      .mockRejectedValueOnce(new Error('falha simulada na automação 1'))
      .mockResolvedValueOnce([okDeal]);
    prisma.automationRun.findFirst.mockResolvedValue(null);
    const enqueue = jest.fn();

    const count = await scanDealSilentForAutomations(prisma as never, enqueue);

    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ extra: { automationId: 'auto-broken', organizationId: 'org-1' } }),
    );
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ automationId: 'auto-2', dealId: 'deal-2' }));
    expect(count).toBe(1);
  });
});
