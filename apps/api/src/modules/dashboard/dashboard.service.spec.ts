import { Test } from '@nestjs/testing';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { DashboardService } from './dashboard.service';

describe('DashboardService', () => {
  let service: DashboardService;
  let prisma: {
    customer: { groupBy: jest.Mock; count: jest.Mock };
    task: { groupBy: jest.Mock };
    organization: { findUniqueOrThrow: jest.Mock };
    activityLog: { findMany: jest.Mock };
    lead: { count: jest.Mock; groupBy: jest.Mock; findMany: jest.Mock };
    scrapeJob: { findMany: jest.Mock };
    $queryRaw: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      customer: { groupBy: jest.fn(), count: jest.fn() },
      task: { groupBy: jest.fn() },
      organization: { findUniqueOrThrow: jest.fn() },
      activityLog: { findMany: jest.fn() },
      lead: { count: jest.fn(), groupBy: jest.fn(), findMany: jest.fn() },
      scrapeJob: { findMany: jest.fn() },
      $queryRaw: jest.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [DashboardService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(DashboardService);
  });

  it('agrega clientes por status, preenchendo com zero os status sem nenhum cliente', async () => {
    prisma.customer.groupBy.mockResolvedValue([
      { status: 'ACTIVE', _count: { _all: 3 } },
      { status: 'LEAD', _count: { _all: 1 } },
    ]);
    prisma.task.groupBy.mockResolvedValue([]);
    prisma.organization.findUniqueOrThrow.mockResolvedValue({ inactiveAfterDays: 14 });
    prisma.activityLog.findMany.mockResolvedValue([]);
    prisma.customer.count.mockResolvedValue(0);

    const result = await service.getOverview('org-1');

    expect(result.customers.byStatus).toEqual({ LEAD: 1, ACTIVE: 3, INACTIVE: 0 });
    expect(result.customers.total).toBe(4);
  });

  it('agrega tarefas por status, preenchendo com zero os status sem nenhuma tarefa', async () => {
    prisma.customer.groupBy.mockResolvedValue([]);
    prisma.task.groupBy.mockResolvedValue([
      { status: 'OPEN', _count: { _all: 2 } },
      { status: 'DONE', _count: { _all: 5 } },
    ]);
    prisma.organization.findUniqueOrThrow.mockResolvedValue({ inactiveAfterDays: 14 });
    prisma.activityLog.findMany.mockResolvedValue([]);
    prisma.customer.count.mockResolvedValue(0);

    const result = await service.getOverview('org-1');

    expect(result.tasks.byStatus).toEqual({ OPEN: 2, IN_PROGRESS: 0, DONE: 5, CANCELLED: 0 });
    expect(result.tasks.total).toBe(7);
  });

  it('conta clientes inativos usando organization.inactiveAfterDays (regra do PRD §8)', async () => {
    prisma.customer.groupBy.mockResolvedValue([]);
    prisma.task.groupBy.mockResolvedValue([]);
    prisma.organization.findUniqueOrThrow.mockResolvedValue({ inactiveAfterDays: 30 });
    prisma.activityLog.findMany.mockResolvedValue([]);
    prisma.customer.count.mockResolvedValue(7);

    const result = await service.getOverview('org-1');

    const call = prisma.customer.count.mock.calls[0][0];
    expect(call.where.organizationId).toBe('org-1');
    expect(call.where.deletedAt).toBeNull();
    const cutoff: Date = call.where.lastActivityAt.lt;
    const expectedCutoff = new Date();
    expectedCutoff.setDate(expectedCutoff.getDate() - 30);
    expect(Math.abs(cutoff.getTime() - expectedCutoff.getTime())).toBeLessThan(5000);
    expect(result.customers.inactiveByRule).toBe(7);
  });

  it('retorna as atividades mais recentes da organização', async () => {
    const activity = [{ id: 'act-1' }];
    prisma.customer.groupBy.mockResolvedValue([]);
    prisma.task.groupBy.mockResolvedValue([]);
    prisma.organization.findUniqueOrThrow.mockResolvedValue({ inactiveAfterDays: 14 });
    prisma.activityLog.findMany.mockResolvedValue(activity);
    prisma.customer.count.mockResolvedValue(0);

    const result = await service.getOverview('org-1');

    expect(prisma.activityLog.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-1' },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    expect(result.recentActivity).toBe(activity);
  });
});

describe('DashboardService.getLeadPipelineOverview', () => {
  let service: DashboardService;
  let prisma: {
    lead: { count: jest.Mock; groupBy: jest.Mock; findMany: jest.Mock };
    scrapeJob: { findMany: jest.Mock };
    $queryRaw: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      lead: { count: jest.fn(), groupBy: jest.fn(), findMany: jest.fn() },
      scrapeJob: { findMany: jest.fn() },
      $queryRaw: jest.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [DashboardService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(DashboardService);
  });

  // Ordem de resolução em `Promise.all` bate com a ordem das chamadas no
  // service: total, sem-site, groupBy status, $queryRaw (cidade), $queryRaw
  // (dia), recentLeads, recentScrapeJobs.
  function mockAll({
    total = 0,
    withoutWebsite = 0,
    byStatus = [] as Array<{ status: string; _count: { _all: number } }>,
    byCity = [] as Array<{ city: string | null; state: string | null; count: number | bigint; withoutWebsite: number | bigint }>,
    byDay = [] as Array<{ day: Date; total: number | bigint; withoutWebsite: number | bigint }>,
    recentLeads = [] as unknown[],
    recentScrapeJobs = [] as unknown[],
  } = {}) {
    prisma.lead.count.mockResolvedValueOnce(total).mockResolvedValueOnce(withoutWebsite);
    prisma.lead.groupBy.mockResolvedValue(byStatus);
    prisma.$queryRaw.mockResolvedValueOnce(byCity).mockResolvedValueOnce(byDay);
    prisma.lead.findMany.mockResolvedValue(recentLeads);
    prisma.scrapeJob.findMany.mockResolvedValue(recentScrapeJobs);
  }

  it('calcula qualificationRate como QUALIFIED / (QUALIFIED + DISQUALIFIED)', async () => {
    mockAll({
      byStatus: [
        { status: 'QUALIFIED', _count: { _all: 3 } },
        { status: 'DISQUALIFIED', _count: { _all: 1 } },
        { status: 'DISCOVERED', _count: { _all: 5 } },
      ],
    });

    const result = await service.getLeadPipelineOverview('org-1');

    expect(result.qualificationRate).toBe(0.75);
    expect(result.leadsByStatus).toEqual({
      DISCOVERED: 5,
      QUALIFIED: 3,
      DISQUALIFIED: 1,
      OUTREACH_DRAFTED: 0,
      OUTREACH_APPROVED: 0,
      CONTACTED: 0,
      REPLIED: 0,
      CONVERTED: 0,
      LOST: 0,
    });
  });

  it('retorna qualificationRate 0 quando não há QUALIFIED nem DISQUALIFIED (denominador zero)', async () => {
    mockAll({ byStatus: [{ status: 'DISCOVERED', _count: { _all: 10 } }] });

    const result = await service.getLeadPipelineOverview('org-1');

    expect(result.qualificationRate).toBe(0);
  });

  it('conta leads sem site com website IS NULL OR website vazio', async () => {
    mockAll({ withoutWebsite: 4 });

    const result = await service.getLeadPipelineOverview('org-1');

    expect(prisma.lead.count).toHaveBeenNthCalledWith(2, {
      where: { organizationId: 'org-1', OR: [{ website: null }, { website: '' }] },
    });
    expect(result.leadsWithoutWebsite).toBe(4);
  });

  it('parametriza organizationId nas duas queries $queryRaw (nunca por interpolação de string crua)', async () => {
    mockAll();

    await service.getLeadPipelineOverview('org-1');

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    for (const call of prisma.$queryRaw.mock.calls) {
      const [strings, ...values] = call as [TemplateStringsArray, ...unknown[]];
      // `organizationId` chega como VALOR interpolado do tagged template
      // (parametrizado pelo Prisma), nunca concatenado dentro dos literais
      // SQL em `strings` — o mesmo padrão de `AiUsageService.getDailySeries`
      // e `SearchDocumentsTool`.
      expect(values).toContain('org-1');
      for (const part of strings) {
        expect(part.includes('org-1')).toBe(false);
      }
    }
  });

  it('normaliza bigint de leadsByCity/leadsByDay para number', async () => {
    mockAll({
      byCity: [{ city: 'São Paulo', state: 'SP', count: 5n, withoutWebsite: 2n }],
      byDay: [{ day: new Date('2026-08-20T00:00:00Z'), total: 3n, withoutWebsite: 1n }],
    });

    const result = await service.getLeadPipelineOverview('org-1');

    expect(result.leadsByCity).toEqual([{ city: 'São Paulo', state: 'SP', count: 5, withoutWebsite: 2 }]);
    expect(result.leadsByDay).toEqual([{ date: '2026-08-20', total: 3, withoutWebsite: 1 }]);
  });

  it('busca os últimos 8 leads e os últimos 5 scrape jobs, mais recentes primeiro', async () => {
    mockAll();

    await service.getLeadPipelineOverview('org-1');

    expect(prisma.lead.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-1' },
      orderBy: { discoveredAt: 'desc' },
      take: 8,
    });
    expect(prisma.scrapeJob.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-1' },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
  });
});
