import { AiUsageService } from './ai-usage.service';
import type { PrismaService } from '../../../infrastructure/database/prisma.service';
import type { BudgetService } from './budget.service';

describe('AiUsageService', () => {
  let service: AiUsageService;
  let prisma: {
    organization: { findUniqueOrThrow: jest.Mock };
    aIRequest: { groupBy: jest.Mock; findMany: jest.Mock };
    user: { findMany: jest.Mock };
    $queryRaw: jest.Mock;
  };
  let budgetService: { getMonthSpend: jest.Mock };

  beforeEach(() => {
    prisma = {
      organization: { findUniqueOrThrow: jest.fn() },
      aIRequest: { groupBy: jest.fn(), findMany: jest.fn() },
      user: { findMany: jest.fn() },
      $queryRaw: jest.fn(),
    };
    budgetService = { getMonthSpend: jest.fn() };
    service = new AiUsageService(prisma as unknown as PrismaService, budgetService as unknown as BudgetService);
  });

  describe('getSummary', () => {
    it('combina orçamento, gasto do mês, série diária e breakdown por usuário', async () => {
      prisma.organization.findUniqueOrThrow.mockResolvedValue({ aiMonthlyBudget: '100' });
      budgetService.getMonthSpend.mockResolvedValue(42.5);
      prisma.$queryRaw.mockResolvedValue([{ day: new Date('2026-08-01T00:00:00Z'), cost: '10', requests: 2n }]);
      prisma.aIRequest.groupBy.mockResolvedValue([
        { userId: 'user-1', _sum: { estimatedCost: '10', inputTokens: 100, outputTokens: 50 }, _count: { _all: 2 } },
      ]);
      prisma.user.findMany.mockResolvedValue([{ id: 'user-1', name: 'Ana' }]);

      const result = await service.getSummary('org-1');

      expect(result).toEqual({
        monthSpend: 42.5,
        monthlyBudget: 100,
        dailySeries: [{ date: '2026-08-01', cost: 10, requests: 2 }],
        byUser: [{ userId: 'user-1', name: 'Ana', cost: 10, requests: 2, inputTokens: 100, outputTokens: 50 }],
      });
    });

    it('monthlyBudget é null quando a organização não tem orçamento configurado', async () => {
      prisma.organization.findUniqueOrThrow.mockResolvedValue({ aiMonthlyBudget: null });
      budgetService.getMonthSpend.mockResolvedValue(0);
      prisma.$queryRaw.mockResolvedValue([]);
      prisma.aIRequest.groupBy.mockResolvedValue([]);

      const result = await service.getSummary('org-1');

      expect(result.monthlyBudget).toBeNull();
      expect(result.byUser).toEqual([]);
    });
  });

  describe('listRecent', () => {
    it('lista requests recentes com tool calls e nome do usuário', async () => {
      prisma.aIRequest.findMany.mockResolvedValue([
        {
          id: 'req-1',
          userId: 'user-1',
          model: 'claude-opus-5',
          status: 'SUCCESS',
          inputTokens: 100,
          outputTokens: 50,
          latencyMs: 800,
          estimatedCost: '0.0025',
          createdAt: new Date('2026-08-29T12:00:00.000Z'),
          user: { name: 'Ana' },
          toolCalls: [{ toolName: 'search_customers', isError: false, input: { query: 'Acme' }, output: [] }],
        },
      ]);

      const result = await service.listRecent('org-1');

      expect(result).toEqual([
        {
          id: 'req-1',
          userId: 'user-1',
          userName: 'Ana',
          model: 'claude-opus-5',
          status: 'SUCCESS',
          inputTokens: 100,
          outputTokens: 50,
          latencyMs: 800,
          estimatedCost: 0.0025,
          createdAt: '2026-08-29T12:00:00.000Z',
          toolCalls: [{ toolName: 'search_customers', isError: false, input: { query: 'Acme' }, output: [] }],
        },
      ]);
      expect(prisma.aIRequest.findMany).toHaveBeenCalledWith({
        where: { organizationId: 'org-1' },
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: { toolCalls: true, user: { select: { name: true } } },
      });
    });
  });
});
