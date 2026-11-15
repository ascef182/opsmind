import { automationJobId } from './automation.types';

describe('automationJobId', () => {
  it('usa automationId + dealId quando dealId está presente', () => {
    const id = automationJobId({
      organizationId: 'org-1', automationId: 'auto-1', customerId: 'cust-1', dealId: 'deal-1',
      actorType: 'SYSTEM',
    });
    expect(id).toBe('auto-1:deal-1');
  });

  it('usa automationId + customerId quando dealId está ausente (ex.: CUSTOMER_INACTIVE)', () => {
    const id = automationJobId({
      organizationId: 'org-1', automationId: 'auto-1', customerId: 'cust-1', actorType: 'SYSTEM',
    });
    expect(id).toBe('auto-1:cust-1');
  });
});
