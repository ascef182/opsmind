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

  it('usage: retorna o gasto do mês e o orçamento configurado da organização', async () => {
    const aiService = { chat: jest.fn() };
    const budgetService = { getMonthSpend: jest.fn().mockResolvedValue(12.5) };
    const controller = new AiController(aiService as never, budgetService as never);

    const result = await controller.usage('org-1', {
      organizationId: 'org-1',
      role: 'OWNER',
    } as never);

    expect(result).toEqual({ monthSpend: 12.5 });
    expect(budgetService.getMonthSpend).toHaveBeenCalledWith('org-1');
  });
});
