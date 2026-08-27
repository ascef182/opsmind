import { canAssignRole } from './can-assign-role';

describe('canAssignRole', () => {
  it('permite atribuir/agir sobre um papel estritamente menos privilegiado', () => {
    expect(canAssignRole('OWNER', 'ADMIN')).toBe(true);
    expect(canAssignRole('ADMIN', 'MEMBER')).toBe(true);
    expect(canAssignRole('OWNER', 'VIEWER')).toBe(true);
  });

  it('rejeita atribuir/agir sobre um papel igual ao do ator (checklist de segurança da Fase 1)', () => {
    expect(canAssignRole('ADMIN', 'ADMIN')).toBe(false);
    expect(canAssignRole('OWNER', 'OWNER')).toBe(false);
  });

  it('rejeita atribuir/agir sobre um papel mais privilegiado que o do ator', () => {
    expect(canAssignRole('MEMBER', 'ADMIN')).toBe(false);
    expect(canAssignRole('ADMIN', 'OWNER')).toBe(false);
  });
});
