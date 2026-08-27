import { JwtAccessStrategy } from './jwt-access.strategy';

describe('JwtAccessStrategy', () => {
  it('valida o payload e expõe apenas id e email (nunca organizationId/role)', () => {
    const configService = { get: () => 'test-secret-with-32-plus-characters' };
    const strategy = new JwtAccessStrategy(configService as never);

    const result = strategy.validate({ sub: 'user-1', email: 'a@b.com' });

    expect(result).toEqual({ id: 'user-1', email: 'a@b.com' });
  });
});
