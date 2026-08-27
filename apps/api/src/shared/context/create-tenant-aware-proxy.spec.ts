import { AsyncLocalStorage } from 'node:async_hooks';
import { createTenantAwareProxy } from './create-tenant-aware-proxy';

describe('createTenantAwareProxy', () => {
  it('delega para o alvo quando não há contexto ativo no ALS', () => {
    const target = { customer: 'raw-client-customer' };
    const storage = new AsyncLocalStorage<Partial<typeof target>>();

    const proxy = createTenantAwareProxy(target, storage);

    expect(proxy.customer).toBe('raw-client-customer');
  });

  it('delega para o valor do contexto ativo quando ele existe', () => {
    const target = { customer: 'raw-client-customer' };
    const storage = new AsyncLocalStorage<Partial<typeof target>>();
    const scoped = { customer: 'tx-scoped-customer' };

    let result: string | undefined;
    storage.run(scoped, () => {
      const proxy = createTenantAwareProxy(target, storage);
      result = proxy.customer;
    });

    expect(result).toBe('tx-scoped-customer');
  });

  it('cai de volta pro alvo quando a propriedade não existe no contexto ativo', () => {
    const target = { customer: 'raw', $transaction: 'raw-transaction-fn' };
    const storage = new AsyncLocalStorage<Partial<typeof target>>();
    // O tx client (contexto ativo) não tem $transaction — Prisma não permite
    // transação aninhada de verdade.
    const scoped = { customer: 'scoped' };

    let txResult: unknown;
    storage.run(scoped, () => {
      const proxy = createTenantAwareProxy(target, storage);
      txResult = proxy.$transaction;
    });

    expect(txResult).toBe('raw-transaction-fn');
  });

  it('preserva o "this" correto ao chamar métodos do alvo (evita quebrar campos privados)', () => {
    class Target {
      #secret = 'segredo-privado';
      reveal() {
        return this.#secret;
      }
    }
    const target = new Target();
    const storage = new AsyncLocalStorage<Partial<Target>>();

    const proxy = createTenantAwareProxy(target, storage);

    expect(proxy.reveal()).toBe('segredo-privado');
  });
});
