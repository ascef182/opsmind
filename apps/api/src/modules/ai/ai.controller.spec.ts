import { AiController } from './ai.controller';

describe('AiController', () => {
  it('chat: repassa organizationId, userId e role da membership para o AiService', async () => {
    const aiService = { chat: jest.fn().mockResolvedValue({ reply: 'oi!', aiRequestId: 'req-1' }) };
    const budgetService = { getMonthSpend: jest.fn() };
    const controller = new AiController(aiService as never, budgetService as never);

    const result = await controller.chat(
      'org-1',
      { id: 'user-1' } as never,
      { organizationId: 'org-1', role: 'MEMBER' } as never,
      { message: 'oi' },
    );

    expect(result).toEqual({ reply: 'oi!', aiRequestId: 'req-1' });
    expect(aiService.chat).toHaveBeenCalledWith(
      { organizationId: 'org-1', userId: 'user-1', role: 'MEMBER' },
      { message: 'oi' },
    );
  });

  it('usage: retorna o summary com gasto, orçamento, série diária e breakdown por usuário', async () => {
    const aiService = { chat: jest.fn() };
    const aiUsageService = {
      getSummary: jest.fn().mockResolvedValue({
        monthSpend: 12.5,
        monthlyBudget: 100,
        dailySeries: [],
        byUser: [],
      }),
    };
    const controller = new AiController(aiService as never, aiUsageService as never);

    const result = await controller.usage('org-1');

    expect(result).toEqual({
      monthSpend: 12.5,
      monthlyBudget: 100,
      dailySeries: [],
      byUser: [],
    });
    expect(aiUsageService.getSummary).toHaveBeenCalledWith('org-1');
  });
});
