import type { ConfigService } from '@nestjs/config';
import type { Env } from '@opsmind/config/env/schema';
import { PrismaClient } from '@opsmind/database';
import { PrismaOutOfBandService } from './prisma-out-of-band.service';

const fakeConfigService = {
  get: () => 'postgresql://user:pass@localhost:5432/db?schema=public',
} as unknown as ConfigService<Env, true>;

describe('PrismaOutOfBandService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('SEMPRE abre uma transação nova e independente (client Prisma próprio, nunca o proxy tenant-aware)', async () => {
    const fakeTx = { $executeRaw: jest.fn().mockResolvedValue(undefined) };
    const transactionSpy = jest
      .spyOn(PrismaClient.prototype, '$transaction')
      .mockImplementation(((fn: (tx: unknown) => unknown) => fn(fakeTx)) as never);
    const service = new PrismaOutOfBandService(fakeConfigService);

    const result = await service.runOutsideTransaction('org-1', async (tx) => {
      expect(tx).toBe(fakeTx);
      return 'ok';
    });

    expect(result).toBe('ok');
    expect(transactionSpy).toHaveBeenCalledTimes(1);
    expect(transactionSpy.mock.calls[0]?.[1]).toEqual({ timeout: 10_000 });
  });

  it('seta app.current_org_id na transação nova, parametrizado (nunca por interpolação de string crua)', async () => {
    const fakeTx = { $executeRaw: jest.fn().mockResolvedValue(undefined) };
    jest
      .spyOn(PrismaClient.prototype, '$transaction')
      .mockImplementation(((fn: (tx: unknown) => unknown) => fn(fakeTx)) as never);
    const service = new PrismaOutOfBandService(fakeConfigService);

    await service.runOutsideTransaction('org-1', async () => 'ok');

    expect(fakeTx.$executeRaw).toHaveBeenCalledTimes(1);
    const [strings, ...values] = fakeTx.$executeRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    expect(values).toContain('org-1');
    for (const part of strings) {
      expect(part.includes('org-1')).toBe(false);
    }
  });
});
