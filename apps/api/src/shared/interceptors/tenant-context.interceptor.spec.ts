import { of, throwError, lastValueFrom } from 'rxjs';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { tenantContextStorage } from '../context/tenant-context.storage';
import { TenantContextInterceptor } from './tenant-context.interceptor';

function createContext(request: Record<string, unknown>): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('TenantContextInterceptor', () => {
  let interceptor: TenantContextInterceptor;
  let prisma: { runInTransaction: jest.Mock };
  let tx: { $executeRaw: jest.Mock };

  beforeEach(() => {
    tx = { $executeRaw: jest.fn().mockResolvedValue(undefined) };
    prisma = {
      runInTransaction: jest.fn((callback: (tx: unknown) => unknown) => callback(tx)),
    };
    interceptor = new TenantContextInterceptor(prisma as unknown as PrismaService);
  });

  it('não abre transação nem toca no ALS para rotas públicas (sem req.user)', async () => {
    const handle = jest.fn().mockReturnValue(of('resultado'));
    const next: CallHandler = { handle };

    const result = await lastValueFrom(interceptor.intercept(createContext({}), next));

    expect(result).toBe('resultado');
    expect(prisma.runInTransaction).not.toHaveBeenCalled();
  });

  it('seta app.current_user_id quando a rota está autenticada mas sem organização (ex.: GET /auth/me)', async () => {
    const handle = jest.fn().mockReturnValue(of('resultado'));
    const next: CallHandler = { handle };
    const request = { user: { id: 'user-1' } };

    const result = await lastValueFrom(interceptor.intercept(createContext(request), next));

    expect(result).toBe('resultado');
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    const [strings, ...values] = tx.$executeRaw.mock.calls[0];
    expect(strings.join('?')).toContain('current_user_id');
    expect(values).toContain('user-1');
  });

  it('seta app.current_user_id e app.current_org_id quando a rota tem TenantGuard (req.membership)', async () => {
    const handle = jest.fn().mockReturnValue(of('resultado'));
    const next: CallHandler = { handle };
    const request = { user: { id: 'user-1' }, membership: { organizationId: 'org-1' } };

    await lastValueFrom(interceptor.intercept(createContext(request), next));

    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
    const secondCall = tx.$executeRaw.mock.calls[1];
    expect(secondCall[0].join('?')).toContain('current_org_id');
    expect(secondCall.slice(1)).toContain('org-1');
  });

  it('disponibiliza a transação via ALS durante a execução do handler', async () => {
    let observedDuringHandler: unknown;
    const handle = jest.fn().mockImplementation(() => {
      observedDuringHandler = tenantContextStorage.getStore();
      return of('resultado');
    });
    const next: CallHandler = { handle };
    const request = { user: { id: 'user-1' } };

    await lastValueFrom(interceptor.intercept(createContext(request), next));

    expect(observedDuringHandler).toBe(tx);
    // Fora do handler, o ALS não deve mais expor a transação.
    expect(tenantContextStorage.getStore()).toBeUndefined();
  });

  it('propaga o erro do handler (permitindo que a transação dê rollback)', async () => {
    const handle = jest.fn().mockReturnValue(throwError(() => new Error('falhou')));
    const next: CallHandler = { handle };
    const request = { user: { id: 'user-1' } };

    await expect(
      lastValueFrom(interceptor.intercept(createContext(request), next)),
    ).rejects.toThrow('falhou');
  });
});
