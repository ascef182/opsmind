import { ROLE_HIERARCHY, WRITE_ROLES } from './roles.constant';

describe('ROLE_HIERARCHY', () => {
  it('ordena os papéis do mais para o menos privilegiado', () => {
    expect(ROLE_HIERARCHY).toEqual(['OWNER', 'ADMIN', 'MANAGER', 'MEMBER', 'VIEWER']);
  });
});

describe('WRITE_ROLES', () => {
  it('inclui todo papel exceto VIEWER — CRM/tarefas/tools de IA são trabalho operacional', () => {
    expect(WRITE_ROLES).toEqual(['OWNER', 'ADMIN', 'MANAGER', 'MEMBER']);
    expect(WRITE_ROLES).not.toContain('VIEWER');
  });
});
