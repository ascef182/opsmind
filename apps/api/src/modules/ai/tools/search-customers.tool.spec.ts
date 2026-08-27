import { SearchCustomersTool } from './search-customers.tool';

describe('SearchCustomersTool', () => {
  it('busca clientes filtrando sempre pelo organizationId do contexto', async () => {
    const customers = [{ id: 'cust-1', name: 'Acme' }];
    const customersService = { list: jest.fn().mockResolvedValue(customers) };
    const tool = new SearchCustomersTool(customersService as never);

    const result = await tool.execute(
      { query: 'acme', status: 'ACTIVE' },
      { organizationId: 'org-1', userId: 'user-1', role: 'VIEWER' },
    );

    expect(result).toBe(customers);
    expect(customersService.list).toHaveBeenCalledWith('org-1', {
      search: 'acme',
      status: 'ACTIVE',
    });
  });

  it('funciona sem nenhum filtro opcional informado', async () => {
    const customersService = { list: jest.fn().mockResolvedValue([]) };
    const tool = new SearchCustomersTool(customersService as never);

    await tool.execute({}, { organizationId: 'org-1', userId: 'user-1', role: 'VIEWER' });

    expect(customersService.list).toHaveBeenCalledWith('org-1', {
      search: undefined,
      status: undefined,
    });
  });
});
