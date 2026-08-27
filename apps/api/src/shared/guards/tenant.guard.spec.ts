import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { TenantGuard } from './tenant.guard';

function createContext(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('TenantGuard', () => {
  let guard: TenantGuard;
  let prisma: { membership: { findUnique: jest.Mock } };

  beforeEach(() => {
    prisma = { membership: { findUnique: jest.fn() } };
    guard = new TenantGuard(prisma as unknown as PrismaService);
  });

  it('libera acesso e anexa req.membership quando o usuário é membro da organização', async () => {
    const membership = { id: 'm-1', userId: 'user-1', organizationId: 'org-1', role: 'ADMIN' };
    prisma.membership.findUnique.mockResolvedValue(membership);
    const request: Record<string, unknown> = {
      params: { organizationId: 'org-1' },
      user: { id: 'user-1' },
    };

    const result = await guard.canActivate(createContext(request));

    expect(prisma.membership.findUnique).toHaveBeenCalledWith({
      where: { userId_organizationId: { userId: 'user-1', organizationId: 'org-1' } },
    });
    expect(result).toBe(true);
    expect(request.membership).toBe(membership);
  });

  it('rejeita com 403 quando o usuário não tem vínculo com a organização', async () => {
    prisma.membership.findUnique.mockResolvedValue(null);
    const request = { params: { organizationId: 'org-1' }, user: { id: 'user-1' } };

    await expect(guard.canActivate(createContext(request))).rejects.toThrow(ForbiddenException);
  });

  it('lança erro de configuração quando a rota não tem :organizationId', async () => {
    const request = { params: {}, user: { id: 'user-1' } };

    await expect(guard.canActivate(createContext(request))).rejects.toThrow(
      /organizationId/,
    );
  });
});
