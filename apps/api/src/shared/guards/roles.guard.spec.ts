import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';

function createContext(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => jest.fn(),
    getClass: () => jest.fn(),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  it('libera acesso quando a rota não declara @Roles()', () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(undefined) } as unknown as Reflector;
    const guard = new RolesGuard(reflector);

    const result = guard.canActivate(createContext({ membership: { role: 'MEMBER' } }));

    expect(result).toBe(true);
  });

  it('libera acesso quando o papel do membership é mais privilegiado que o exigido', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(['ADMIN']),
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);

    // OWNER está acima de ADMIN na hierarquia — deve passar.
    const result = guard.canActivate(createContext({ membership: { role: 'OWNER' } }));

    expect(result).toBe(true);
  });

  it('libera acesso quando o papel do membership é exatamente o exigido', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(['ADMIN']),
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);

    const result = guard.canActivate(createContext({ membership: { role: 'ADMIN' } }));

    expect(result).toBe(true);
  });

  it('rejeita com 403 quando o papel do membership é menos privilegiado que o exigido', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(['ADMIN']),
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);

    expect(() => guard.canActivate(createContext({ membership: { role: 'MEMBER' } }))).toThrow(
      ForbiddenException,
    );
  });

  it('rejeita com 403 quando não há req.membership (TenantGuard não rodou antes)', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(['ADMIN']),
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);

    expect(() => guard.canActivate(createContext({}))).toThrow(ForbiddenException);
  });
});
