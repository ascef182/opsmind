import { GetCustomerTool } from './get-customer.tool';

describe('GetCustomerTool', () => {
  it('busca o cliente usando o organizationId do contexto, não de um input do modelo', async () => {
    const customer = { id: 'cust-1', name: 'Acme' };
    const customersService = { findByIdOrThrow: jest.fn().mockResolvedValue(customer) };
    const tool = new GetCustomerTool(customersService as never);

    const result = await tool.execute(
      { customerId: 'cust-1' },
      { organizationId: 'org-1', userId: 'user-1', role: 'MEMBER' },
    );

    expect(result).toBe(customer);
    expect(customersService.findByIdOrThrow).toHaveBeenCalledWith('org-1', 'cust-1');
  });

  it('ignora qualquer organizationId que apareça dentro do input, sempre usa o do contexto', async () => {
    const customersService = { findByIdOrThrow: jest.fn().mockResolvedValue({ id: 'cust-1' }) };
    const tool = new GetCustomerTool(customersService as never);

    await tool.execute(
      { customerId: 'cust-1', organizationId: 'org-invasor' } as never,
      { organizationId: 'org-1', userId: 'user-1', role: 'MEMBER' },
    );

    expect(customersService.findByIdOrThrow).toHaveBeenCalledWith('org-1', 'cust-1');
  });
});
