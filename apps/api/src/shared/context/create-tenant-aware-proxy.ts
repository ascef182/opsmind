import type { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Envolve `target` num Proxy que, para toda propriedade lida, prefere o valor
 * do contexto ativo do `storage` (quando existir e tiver essa propriedade) —
 * senão cai para `target`. Usado para fazer `PrismaService` enxergar
 * transparentemente a transação de request aberta pelo
 * `TenantContextInterceptor`, sem qualquer service precisar saber disso.
 *
 * Importante: o `receiver` passado a `Reflect.get` é sempre o objeto real
 * (`target` ou o valor do contexto), nunca o proxy — confirmado empiricamente
 * que isso é necessário para não quebrar getters/métodos do PrismaClient
 * gerado que dependem da identidade exata do `this`.
 */
export function createTenantAwareProxy<T extends object, S extends object>(
  target: T,
  storage: AsyncLocalStorage<S>,
): T {
  return new Proxy(target, {
    get(_target, prop, _receiver) {
      const activeContext = storage.getStore();
      const owner: object = activeContext && prop in activeContext ? activeContext : target;
      const value = Reflect.get(owner, prop, owner);
      // Se `proxy.metodo()` for chamado diretamente (sem passar por uma
      // sub-propriedade intermediária, como em `proxy.customer.findMany()`),
      // o `this` dentro de `metodo` seria o proxy, não `owner` — quebrando
      // qualquer implementação que dependa de campos privados (`#campo`).
      // Bind explícito fecha essa brecha para qualquer valor devolvido,
      // não só os que o Prisma feliz coincidentemente não usa esse padrão.
      return typeof value === 'function' ? value.bind(owner) : value;
    },
  });
}
