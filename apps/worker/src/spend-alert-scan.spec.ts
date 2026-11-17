jest.mock('./tenant-context', () => ({
  withTenantContext: jest.fn((prisma: unknown, _organizationId: string, fn: (tx: unknown) => unknown) => fn(prisma)),
}));

import { crossedThreshold, scanSpendAlerts } from './spend-alert-scan';

function buildPrisma(opts: { engineSpent?: number; aiBudget?: number | null; aiSpent?: number } = {}) {
  return {
    organization: {
      findMany: jest.fn().mockResolvedValue([{ id: 'org-1', aiMonthlyBudget: opts.aiBudget ?? null }]),
    },
    costEvent: { aggregate: jest.fn().mockResolvedValue({ _sum: { amountUsd: opts.engineSpent ?? 0 } }) },
    organizationRevenueSettings: { findUnique: jest.fn().mockResolvedValue(null) },
    aIRequest: { aggregate: jest.fn().mockResolvedValue({ _sum: { estimatedCost: opts.aiSpent ?? 0 } }) },
    membership: {
      findMany: jest.fn().mockResolvedValue([{ userId: 'owner-1' }, { userId: 'admin-1' }]),
    },
    notification: { createMany: jest.fn() },
  };
}

// Redis em memória só com o `SET ... NX` que o scan usa.
function buildRedis() {
  const store = new Set<string>();
  return {
    store,
    set: jest.fn(async (key: string) => {
      if (store.has(key)) return null;
      store.add(key);
      return 'OK';
    }),
  };
}

const now = new Date('2026-11-17T12:00:00Z');

describe('crossedThreshold', () => {
  it.each([
    [10, 50, null],
    [25, 50, 0.5],
    [41, 50, 0.8],
    [50, 50, 1],
    [80, 50, 1],
    [10, 0, null],
  ])('gasto %p de teto %p → %p', (spent, budget, expected) => {
    expect(crossedThreshold(spent, budget)).toBe(expected);
  });
});

describe('scanSpendAlerts', () => {
  it('avisa OWNER/ADMIN uma vez ao cruzar 80% do teto do Revenue Engine', async () => {
    const prisma = buildPrisma({ engineSpent: 42 });
    const redis = buildRedis();

    const first = await scanSpendAlerts(prisma as never, redis as never, now);
    const second = await scanSpendAlerts(prisma as never, redis as never, now);

    expect(first).toBe(2);
    expect(second).toBe(0);
    expect(prisma.notification.createMany).toHaveBeenCalledTimes(1);
    expect(prisma.notification.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          userId: 'owner-1',
          type: 'revenue.spend_alert',
          payload: expect.objectContaining({ budget: 'engine', thresholdPercent: 80, budgetUsd: 50 }),
        }),
        expect.objectContaining({ userId: 'admin-1' }),
      ],
    });
    expect(prisma.membership.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', role: { in: ['OWNER', 'ADMIN'] } },
      select: { userId: true },
    });
  });

  it('pular direto para 100% gera um alerta só, e o de 50% não chega depois', async () => {
    const prisma = buildPrisma({ engineSpent: 60 });
    const redis = buildRedis();

    await scanSpendAlerts(prisma as never, redis as never, now);
    prisma.costEvent.aggregate.mockResolvedValue({ _sum: { amountUsd: 26 } });
    await scanSpendAlerts(prisma as never, redis as never, now);

    expect(prisma.notification.createMany).toHaveBeenCalledTimes(1);
    expect(redis.store).toEqual(
      new Set([
        'spend-alert:org-1:2026-11:engine:100',
        'spend-alert:org-1:2026-11:engine:50',
        'spend-alert:org-1:2026-11:engine:80',
      ]),
    );
  });

  it('orçamento de IA é avisado separado, só quando configurado', async () => {
    const prisma = buildPrisma({ aiBudget: 10, aiSpent: 5 });
    const redis = buildRedis();

    await scanSpendAlerts(prisma as never, redis as never, now);

    expect(prisma.notification.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ payload: expect.objectContaining({ budget: 'ai', thresholdPercent: 50 }) }),
      ]),
    });
  });

  it('abaixo de 50% não avisa nada', async () => {
    const prisma = buildPrisma({ engineSpent: 5 });
    const redis = buildRedis();

    expect(await scanSpendAlerts(prisma as never, redis as never, now)).toBe(0);
    expect(redis.set).not.toHaveBeenCalled();
  });
});
