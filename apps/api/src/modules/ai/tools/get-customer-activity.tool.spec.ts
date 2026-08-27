import { NotFoundException } from '@nestjs/common';
import { GetCustomerActivityTool } from './get-customer-activity.tool';

describe('GetCustomerActivityTool', () => {
  const context = { organizationId: 'org-1', userId: 'user-1', role: 'MEMBER' as const };

  it('confirma que o cliente pertence à organização do contexto antes de listar a timeline', async () => {
    const customersService = { findByIdOrThrow: jest.fn().mockResolvedValue({ id: 'cust-1' }) };
    const activities = [{ id: 'act-1', type: 'note.added' }];
    const activityService = { listForCustomer: jest.fn().mockResolvedValue(activities) };
    const tool = new GetCustomerActivityTool(customersService as never, activityService as never);

    const result = await tool.execute({ customerId: 'cust-1' }, context);

    expect(customersService.findByIdOrThrow).toHaveBeenCalledWith('org-1', 'cust-1');
    expect(activityService.listForCustomer).toHaveBeenCalledWith('org-1', 'cust-1');
    expect(result).toBe(activities);
  });

  it('propaga o 404 e nunca consulta a timeline quando o cliente não pertence à organização', async () => {
    const customersService = {
      findByIdOrThrow: jest.fn().mockRejectedValue(new NotFoundException('Cliente não encontrado')),
    };
    const activityService = { listForCustomer: jest.fn() };
    const tool = new GetCustomerActivityTool(customersService as never, activityService as never);

    await expect(tool.execute({ customerId: 'cust-de-outra-org' }, context)).rejects.toThrow(
      NotFoundException,
    );
    expect(activityService.listForCustomer).not.toHaveBeenCalled();
  });
});
