import { GetCustomerTool } from './get-customer.tool';

describe('GetCustomerTool', () => {
  it('busca o cliente usando o organizationId do contexto, não de um input do modelo', async () => {
    const customer = { id: 'cust-1', name: 'Acme' };
    const customersService = { findByIdOrThrow: jest.fn().mockResolvedValue(customer) };
    const dealsService = { list: jest.fn().mockResolvedValue([]) };
    const tool = new GetCustomerTool(customersService as never, dealsService as never);

    const result = await tool.execute(
      { customerId: 'cust-1' },
      { organizationId: 'org-1', userId: 'user-1', role: 'MEMBER' },
    );

    expect(result).toEqual({ ...customer, openDeals: [] });
    expect(customersService.findByIdOrThrow).toHaveBeenCalledWith('org-1', 'cust-1');
  });

  it('ignora qualquer organizationId que apareça dentro do input, sempre usa o do contexto', async () => {
    const customersService = { findByIdOrThrow: jest.fn().mockResolvedValue({ id: 'cust-1' }) };
    const dealsService = { list: jest.fn().mockResolvedValue([]) };
    const tool = new GetCustomerTool(customersService as never, dealsService as never);

    await tool.execute(
      { customerId: 'cust-1', organizationId: 'org-invasor' } as never,
      { organizationId: 'org-1', userId: 'user-1', role: 'MEMBER' },
    );

    expect(customersService.findByIdOrThrow).toHaveBeenCalledWith('org-1', 'cust-1');
  });

  it('inclui os negócios em aberto do cliente (openDeals), excluindo WON/LOST', async () => {
    const customer = { id: 'cust-1', name: 'Acme' };
    const openDeal = { id: 'deal-1', title: 'Contrato X', stage: 'PROPOSAL', value: 1000, currency: 'BRL' };
    const customersService = { findByIdOrThrow: jest.fn().mockResolvedValue(customer) };
    const dealsService = { list: jest.fn().mockResolvedValue([openDeal]) };
    const tool = new GetCustomerTool(customersService as never, dealsService as never);

    const result = await tool.execute(
      { customerId: 'cust-1' },
      { organizationId: 'org-1', userId: 'user-1', role: 'MEMBER' },
    );

    expect(dealsService.list).toHaveBeenCalledWith('org-1', { customerId: 'cust-1', excludeClosed: true });
    expect(result).toEqual({ ...customer, openDeals: [openDeal] });
  });
});
