import { scanCustomerInactiveAutomations } from './automation-scan';

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
});
