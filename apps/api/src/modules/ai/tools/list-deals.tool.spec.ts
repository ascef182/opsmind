import { ListDealsTool } from './list-deals.tool';

describe('ListDealsTool', () => {
  it('lista deals usando o organizationId do contexto, não de um input do modelo', async () => {
    const deals = [{ id: 'deal-1' }];
    const dealsService = { list: jest.fn().mockResolvedValue(deals) };
    const tool = new ListDealsTool(dealsService as never);

    const result = await tool.execute(
      { stage: 'PROPOSAL' },
      { organizationId: 'org-1', userId: 'user-1', role: 'VIEWER' },
    );

    expect(result).toBe(deals);
    expect(dealsService.list).toHaveBeenCalledWith('org-1', {
      stage: 'PROPOSAL',
      customerId: undefined,
    });
  });

  it('não exige WRITE_ROLES — é leitura pura, disponível até para VIEWER', async () => {
    const dealsService = { list: jest.fn().mockResolvedValue([]) };
    const tool = new ListDealsTool(dealsService as never);

    await expect(
      tool.execute({}, { organizationId: 'org-1', userId: 'user-1', role: 'VIEWER' }),
    ).resolves.toEqual([]);
  });
});
