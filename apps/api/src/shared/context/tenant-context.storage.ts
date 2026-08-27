import { AsyncLocalStorage } from 'node:async_hooks';
import type { Prisma } from '@opsmind/database';

/**
 * Um único armazenamento por processo: a transação Prisma aberta pelo
 * `TenantContextInterceptor` no início de cada request autenticado. Toda
 * chamada a `PrismaService` durante essa request enxerga esta transação
 * (via `createTenantAwareProxy`) em vez do client "cru" — é isso que faz o
 * `SET LOCAL app.current_org_id`/`app.current_user_id` valer para toda
 * query da request, sem que nenhum service precise saber disso.
 */
export const tenantContextStorage = new AsyncLocalStorage<Prisma.TransactionClient>();
