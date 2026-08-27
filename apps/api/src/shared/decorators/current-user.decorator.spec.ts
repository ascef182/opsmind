import { ExecutionContext } from '@nestjs/common';
import { currentUserFactory } from './current-user.decorator';

describe('@CurrentUser()', () => {
  it('extrai req.user populado pelo JwtAuthGuard/JwtAccessStrategy', () => {
    const user = { id: 'user-1', email: 'a@b.com' };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    } as unknown as ExecutionContext;

    const result = currentUserFactory(undefined, ctx);

    expect(result).toBe(user);
  });
});
