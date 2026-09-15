import { ForbiddenException } from '@nestjs/common';
import { CreateDealTool } from './create-deal.tool';

describe('CreateDealTool', () => {
  it('cria o deal usando o organizationId do contexto, não de um input do modelo', async () => {
    const deal = { id: 'deal-1', customerId: 'cust-1', title: 'Contrato X' };
    const dealsService = { create: jest.fn().mockResolvedValue(deal) };
    const tool = new CreateDealTool(dealsService as never);

    const result = await tool.execute(
      { customerId: 'cust-1', title: 'Contrato X', value: 1000 },
      { organizationId: 'org-1', userId: 'user-1', role: 'MEMBER' },
    );

    expect(result).toBe(deal);
    expect(dealsService.create).toHaveBeenCalledWith(
      'org-1',
      { customerId: 'cust-1', title: 'Contrato X', value: 1000, currency: undefined, expectedCloseDate: undefined },
      'user-1',
    );
  });

  it('recusa criar deal quando o papel do usuário que invocou é VIEWER', async () => {
    const dealsService = { create: jest.fn() };
    const tool = new CreateDealTool(dealsService as never);

    await expect(
      tool.execute(
        { customerId: 'cust-1', title: 'Contrato X', value: 1000 },
        { organizationId: 'org-1', userId: 'user-1', role: 'VIEWER' },
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(dealsService.create).not.toHaveBeenCalled();
  });
});
