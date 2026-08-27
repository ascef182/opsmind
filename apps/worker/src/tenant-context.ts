import { PrismaClient, type Prisma } from '@opsmind/database';
import type { Env } from '@opsmind/config/env/schema';

/**
 * Role restrita (sem BYPASSRLS) — nunca a `DATABASE_URL` dona das tabelas.
 * Diferente de apps/api, este client não passa pelo proxy de
 * AsyncLocalStorage (não há requests HTTP concorrentes aqui) — cada job é
 * processado um de cada vez, então uma transação por job é suficiente.
 */
export function createPrismaClient(env: Pick<Env, 'DATABASE_URL_APP'>): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: env.DATABASE_URL_APP } } });
}

/**
 * Define `app.current_org_id` só para a duração desta transação — mesmo
 * padrão de TenantContextInterceptor (apps/api), pra Row-Level Security
 * valer de verdade também aqui. Sem isso, o worker (rodando com a role
 * restrita `opsmind_app`, mas sem nenhum contexto de tenant setado) cairia
 * no fallback "sem contexto = allow" das policies em toda query seguinte —
 * ficaria dependendo só do filtro `organizationId` da aplicação, sem a
 * camada extra que requests HTTP já têm.
 */
export function withTenantContext<T>(
  prisma: PrismaClient,
  organizationId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_org_id', ${organizationId}, true)`;
    return fn(tx);
  });
}
