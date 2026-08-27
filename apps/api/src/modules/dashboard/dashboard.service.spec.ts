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
  };

  beforeEach(async () => {
    prisma = {
      customer: { groupBy: jest.fn(), count: jest.fn() },
      task: { groupBy: jest.fn() },
      organization: { findUniqueOrThrow: jest.fn() },
      activityLog: { findMany: jest.fn() },
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
