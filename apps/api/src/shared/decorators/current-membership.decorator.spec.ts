import { ExecutionContext } from '@nestjs/common';
import { currentMembershipFactory } from './current-membership.decorator';

describe('@CurrentMembership()', () => {
  it('extrai req.membership populado pelo TenantGuard', () => {
    const membership = { id: 'm-1', userId: 'user-1', organizationId: 'org-1', role: 'ADMIN' };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => ({ membership }) }),
    } as unknown as ExecutionContext;

    const result = currentMembershipFactory(undefined, ctx);

    expect(result).toBe(membership);
  });
});
