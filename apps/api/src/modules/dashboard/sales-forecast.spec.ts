import { Test } from '@nestjs/testing';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { DashboardService } from './dashboard.service';

describe('DashboardService.getSalesForecast', () => {
  let service: DashboardService;
  let prisma: {
    deal: { findMany: jest.Mock };
  };

  // Ordem de resolução bate com a ordem das chamadas no service: findMany
  // (deals abertos, pro pipeline ponderado) depois findMany (deals WON, pra
  // tendência de receita fechada).
  function mockAll({
    openDeals = [] as Array<{ stage: string; value: number; expectedCloseDate: Date | null }>,
    wonDeals = [] as Array<{ value: number; actualCloseDate: Date | null }>,
  } = {}) {
    prisma.deal.findMany.mockResolvedValueOnce(openDeals).mockResolvedValueOnce(wonDeals);
  }

  beforeEach(async () => {
    prisma = { deal: { findMany: jest.fn() } };

    const module = await Test.createTestingModule({
      providers: [DashboardService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(DashboardService);

    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-16T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('soma value * probabilidade do estágio pra formar o pipeline ponderado', async () => {
    mockAll({
      openDeals: [
        { stage: 'QUALIFICATION', value: 1000, expectedCloseDate: null },
        { stage: 'NEGOTIATION', value: 2000, expectedCloseDate: null },
      ],
    });

    const result = await service.getSalesForecast('org-1');

    expect(result.weightedPipelineValue).toBe(1300);
  });

  it('retorna weightedPipelineValue 0 quando não há nenhum deal aberto', async () => {
    mockAll({ openDeals: [] });

    const result = await service.getSalesForecast('org-1');

    expect(result.weightedPipelineValue).toBe(0);
  });

  it('soma unscheduledValue só pros deals abertos sem expectedCloseDate', async () => {
    mockAll({
      openDeals: [
        { stage: 'PROPOSAL', value: 500, expectedCloseDate: null },
        { stage: 'PROPOSAL', value: 300, expectedCloseDate: new Date('2026-10-15') },
      ],
    });

    const result = await service.getSalesForecast('org-1');

    expect(result.unscheduledValue).toBe(500);
  });

  it('agrupa forecastByMonth por mês de expectedCloseDate, ordenado ascendente', async () => {
    mockAll({
      openDeals: [
        { stage: 'NEGOTIATION', value: 1000, expectedCloseDate: new Date('2026-11-05') },
        { stage: 'PROPOSAL', value: 2000, expectedCloseDate: new Date('2026-10-20') },
        { stage: 'CONTRACT_SENT', value: 500, expectedCloseDate: new Date('2026-10-01') },
      ],
    });

    const result = await service.getSalesForecast('org-1');

    expect(result.forecastByMonth).toEqual([
      { month: '2026-10', openValue: 2500, weightedValue: 1025, dealCount: 2 },
      { month: '2026-11', openValue: 1000, weightedValue: 600, dealCount: 1 },
    ]);
  });

  it('busca deals abertos filtrando organizationId/deletedAt/stage fora de WON-LOST', async () => {
    mockAll();

    await service.getSalesForecast('org-1');

    expect(prisma.deal.findMany).toHaveBeenNthCalledWith(1, {
      where: { organizationId: 'org-1', deletedAt: null, stage: { notIn: ['WON', 'LOST'] } },
      select: { stage: true, value: true, expectedCloseDate: true },
    });
  });

  it('calcula wonRevenueByMonth pros últimos 6 meses, preenchendo com zero os meses sem nenhum ganho', async () => {
    mockAll({
      wonDeals: [
        { value: 1000, actualCloseDate: new Date('2026-09-10') },
        { value: 500, actualCloseDate: new Date('2026-08-01') },
      ],
    });

    const result = await service.getSalesForecast('org-1');

    expect(result.wonRevenueByMonth).toEqual([
      { month: '2026-04', wonValue: 0, wonCount: 0 },
      { month: '2026-05', wonValue: 0, wonCount: 0 },
      { month: '2026-06', wonValue: 0, wonCount: 0 },
      { month: '2026-07', wonValue: 0, wonCount: 0 },
      { month: '2026-08', wonValue: 500, wonCount: 1 },
      { month: '2026-09', wonValue: 1000, wonCount: 1 },
    ]);
  });

  it('filtra a query de ganhos por stage WON e por uma janela de 6 meses', async () => {
    mockAll();

    await service.getSalesForecast('org-1');

    const call = prisma.deal.findMany.mock.calls[1][0];
    expect(call.where.organizationId).toBe('org-1');
    expect(call.where.deletedAt).toBeNull();
    expect(call.where.stage).toBe('WON');
    expect(call.where.actualCloseDate.gte).toBeInstanceOf(Date);
  });
});
