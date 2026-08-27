import { ListInactiveCustomersTool } from './list-inactive-customers.tool';

describe('ListInactiveCustomersTool', () => {
  it('lista clientes inativos da organização do contexto, sem receber nenhum input do modelo', async () => {
    const inactiveCustomers = [{ id: 'cust-1', name: 'Acme' }];
    const customersService = { listInactive: jest.fn().mockResolvedValue(inactiveCustomers) };
    const tool = new ListInactiveCustomersTool(customersService as never);

    const result = await tool.execute({}, { organizationId: 'org-1', userId: 'user-1', role: 'MEMBER' });

    expect(result).toBe(inactiveCustomers);
    expect(customersService.listInactive).toHaveBeenCalledWith('org-1');
  });
});
