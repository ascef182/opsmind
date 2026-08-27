import type { ConfigService } from '@nestjs/config';
import type { Env } from '@opsmind/config/env/schema';
import { PrismaClient } from '@opsmind/database';
import { tenantContextStorage } from '../../shared/context/tenant-context.storage';
import { PrismaService } from './prisma.service';

// PrismaClient não conecta de verdade no construtor (lazy) — seguro
// instanciar com uma URL qualquer para testar só a lógica de decisão do
// runInTransaction, sem tocar rede/banco.
const fakeConfigService = {
  get: () => 'postgresql://user:pass@localhost:5432/db?schema=public',
} as unknown as ConfigService<Env, true>;

describe('PrismaService', () => {
  describe('runInTransaction', () => {
    // Espiona o método no protótipo, não na instância: a instância real é um
    // Proxy (o construtor devolve `createTenantAwareProxy(this, ...)`), e
    // esse Proxy faz `.bind()` em toda função lida — o que é necessário para
    // não quebrar campos privados do PrismaClient gerado (ver
    // create-tenant-aware-proxy.spec.ts), mas tem o efeito colateral de
    // descartar os metadados de mock do Jest se a gente espionar através do
    // proxy. Espionar o protótipo direto evita esse problema por completo.
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('reusa a transação do ALS quando ela existe — nunca abre uma nova', async () => {
      const transactionSpy = jest.spyOn(PrismaClient.prototype, '$transaction');
      const service = new PrismaService(fakeConfigService);
      const fakeTx = { marker: 'tx-do-request' } as never;

      const result = await tenantContextStorage.run(fakeTx, () =>
        service.runInTransaction(async (tx) => {
          expect(tx).toBe(fakeTx);
          return 'ok';
        }),
      );

      expect(result).toBe('ok');
      expect(transactionSpy).not.toHaveBeenCalled();
    });

    it('cai para $transaction quando não há contexto de request ativo', async () => {
      const transactionSpy = jest
        .spyOn(PrismaClient.prototype, '$transaction')
        .mockImplementation(((fn: (tx: unknown) => unknown) => fn('fallback-tx')) as never);
      const service = new PrismaService(fakeConfigService);

      const result = await service.runInTransaction(async (tx) => {
        expect(tx).toBe('fallback-tx');
        return 'ok';
      });

      expect(result).toBe('ok');
      expect(transactionSpy).toHaveBeenCalledTimes(1);
      // Margem de segurança acima do default do Prisma (5s) — evita cancelar
      // uma request legítima só um pouco mais lenta que o normal.
      expect(transactionSpy.mock.calls[0]?.[1]).toEqual({ timeout: 10_000 });
    });
  });
});
