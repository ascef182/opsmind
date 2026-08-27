import { ROLE_HIERARCHY } from './roles.constant';

describe('ROLE_HIERARCHY', () => {
  it('ordena os papéis do mais para o menos privilegiado', () => {
    expect(ROLE_HIERARCHY).toEqual(['OWNER', 'ADMIN', 'MANAGER', 'MEMBER', 'VIEWER']);
  });
});
