import { Test } from '@nestjs/testing';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { DashboardService } from './dashboard.service';

describe('DashboardService.getDealPipelineOverview', () => {
  let service: DashboardService;
  let prisma: {
    deal: { groupBy: jest.Mock; aggregate: jest.Mock; findMany: jest.Mock };
    $queryRaw: jest.Mock;
  };

  // Ordem de resolução em `Promise.all` bate com a ordem das chamadas no
  // service: aggregate (valor em aberto), groupBy (por estágio), $queryRaw
  // (ciclo médio de venda), findMany (fechando em breve), findMany (ganhos
  // recentes).
  function mockAll({
    openValue = null as number | null,
    byStage = [] as Array<{ stage: string; _count: { _all: number }; _sum: { value: number | null } }>,
    avgSalesCycleRows = [] as Array<{ avgDays: number | null }>,
    dealsClosingSoon = [] as unknown[],
    recentlyWonDeals = [] as unknown[],
  } = {}) {
    prisma.deal.aggregate.mockResolvedValue({ _sum: { value: openValue } });
    prisma.deal.groupBy.mockResolvedValue(byStage);
    prisma.$queryRaw.mockResolvedValue(avgSalesCycleRows);
    prisma.deal.findMany.mockResolvedValueOnce(dealsClosingSoon).mockResolvedValueOnce(recentlyWonDeals);
  }

  beforeEach(async () => {
    prisma = {
      deal: { groupBy: jest.fn(), aggregate: jest.fn(), findMany: jest.fn() },
      $queryRaw: jest.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [DashboardService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(DashboardService);
  });

  it('soma o valor em aberto (stage fora de WON/LOST), 0 quando não há nenhum', async () => {
    mockAll({ openValue: null });

    const result = await service.getDealPipelineOverview('org-1');

    expect(prisma.deal.aggregate).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', deletedAt: null, stage: { notIn: ['WON', 'LOST'] } },
      _sum: { value: true },
    });
    expect(result.openValue).toBe(0);
  });

  it('agrega por estágio (contagem e soma), preenchendo com zero os estágios sem nenhum deal', async () => {
    mockAll({
      byStage: [
        { stage: 'QUALIFICATION', _count: { _all: 2 }, _sum: { value: 500 } },
        { stage: 'WON', _count: { _all: 1 }, _sum: { value: 1000 } },
      ],
    });

    const result = await service.getDealPipelineOverview('org-1');

    expect(result.dealsByStage).toEqual({
      QUALIFICATION: { count: 2, value: 500 },
      PROPOSAL: { count: 0, value: 0 },
      NEGOTIATION: { count: 0, value: 0 },
      CONTRACT_SENT: { count: 0, value: 0 },
      WON: { count: 1, value: 1000 },
      LOST: { count: 0, value: 0 },
    });
  });

  it('calcula winRate como WON / (WON + LOST), 0 quando denominador é zero', async () => {
    mockAll({
      byStage: [
        { stage: 'WON', _count: { _all: 3 }, _sum: { value: 3000 } },
        { stage: 'LOST', _count: { _all: 1 }, _sum: { value: 100 } },
      ],
    });

    const result = await service.getDealPipelineOverview('org-1');

    expect(result.winRate).toBe(0.75);
  });

  it('retorna winRate 0 quando não há nenhum deal WON nem LOST', async () => {
    mockAll({ byStage: [{ stage: 'QUALIFICATION', _count: { _all: 5 }, _sum: { value: 500 } }] });

    const result = await service.getDealPipelineOverview('org-1');

    expect(result.winRate).toBe(0);
  });

  it('retorna avgSalesCycleDays null quando não há nenhum deal WON', async () => {
    mockAll({ avgSalesCycleRows: [{ avgDays: null }] });

    const result = await service.getDealPipelineOverview('org-1');

    expect(result.avgSalesCycleDays).toBeNull();
  });

  it('retorna avgSalesCycleDays a partir do raw query, parametrizando organizationId', async () => {
    mockAll({ avgSalesCycleRows: [{ avgDays: 12.5 }] });

    const result = await service.getDealPipelineOverview('org-1');

    expect(result.avgSalesCycleDays).toBe(12.5);
    const [strings, ...values] = prisma.$queryRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    expect(values).toContain('org-1');
    for (const part of strings) {
      expect(part.includes('org-1')).toBe(false);
    }
  });

  it('busca deals fechando nos próximos 30 dias, excluindo WON/LOST', async () => {
    const closingSoon = [{ id: 'deal-1' }];
    mockAll({ dealsClosingSoon: closingSoon });

    const result = await service.getDealPipelineOverview('org-1');

    expect(result.dealsClosingSoon).toBe(closingSoon);
    const call = prisma.deal.findMany.mock.calls[0][0];
    expect(call.where.organizationId).toBe('org-1');
    expect(call.where.deletedAt).toBeNull();
    expect(call.where.stage).toEqual({ notIn: ['WON', 'LOST'] });
    expect(call.where.expectedCloseDate.gte).toBeInstanceOf(Date);
    expect(call.where.expectedCloseDate.lte).toBeInstanceOf(Date);
  });

  it('busca os ganhos recentes, mais recentes primeiro por actualCloseDate', async () => {
    const won = [{ id: 'deal-2' }];
    mockAll({ recentlyWonDeals: won });

    const result = await service.getDealPipelineOverview('org-1');

    expect(result.recentlyWonDeals).toBe(won);
    expect(prisma.deal.findMany).toHaveBeenNthCalledWith(2, {
      where: { organizationId: 'org-1', deletedAt: null, stage: 'WON' },
      orderBy: { actualCloseDate: 'desc' },
      take: 5,
    });
  });
});
