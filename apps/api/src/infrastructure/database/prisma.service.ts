import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient, type Prisma } from '@opsmind/database';
import type { Env } from '@opsmind/config/env/schema';
import { createTenantAwareProxy } from '../../shared/context/create-tenant-aware-proxy';
import { tenantContextStorage } from '../../shared/context/tenant-context.storage';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(configService: ConfigService<Env, true>) {
    // Role restrita (sem BYPASSRLS) — nunca a mesma conexão usada por
    // `prisma migrate`/seed. Ver infra/docker/init/02-app-role.sql.
    super({
      datasources: { db: { url: configService.get('DATABASE_URL_APP', { infer: true }) } },
    });

    // A partir daqui, `this` (e o que o construtor retorna) é o proxy — toda
    // chamada `prisma.customer.findMany()` feita por qualquer service passa
    // a enxergar a transação de request aberta pelo TenantContextInterceptor,
    // quando ela existir, sem nenhuma mudança nos services.
    return createTenantAwareProxy(this, tenantContextStorage);
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * Substitui `this.$transaction(fn)` nos services que precisam de uma
   * operação atômica de múltiplos statements (ex.: criar Organization +
   * Membership). Dentro de uma request já em transação (o caso comum, via
   * TenantContextInterceptor), reusa essa mesma transação — Postgres não tem
   * transação aninhada de verdade, e abrir uma nova pegaria outra conexão do
   * pool sem `app.current_org_id` setado, fazendo a RLS negar tudo em
   * silêncio. Fora de uma request (scripts, seed, testes), cai para
   * `$transaction` normal.
   */
  runInTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const activeTransaction = tenantContextStorage.getStore();
    if (activeTransaction) {
      return fn(activeTransaction);
    }
    // Margem de segurança acima do default do Prisma (5s) — evita cancelar
    // uma request legítima só um pouco mais lenta que o normal.
    return this.$transaction(fn, { timeout: 10_000 });
  }
}
