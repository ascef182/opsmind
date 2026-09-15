import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient, type Prisma } from '@opsmind/database';
import type { Env } from '@opsmind/config/env/schema';

/**
 * Client Prisma SEPARADO e independente do `PrismaService` (nunca decorado
 * por `createTenantAwareProxy`) — existe só para `runOutsideTransaction`:
 * escritas que precisam sobreviver mesmo quando a transação da request
 * (aberta por `TenantContextInterceptor`, a que `PrismaService` enxerga)
 * sofre rollback. Ex.: `AIRequest`/`AIRequestToolCall` de uma tentativa de
 * IA que terminou em ERROR/BUDGET_EXCEEDED — o método chamador relança o
 * erro logo depois de persistir esse registro, e sem esta classe separada a
 * escrita inteira era descartada pelo rollback (achado ao vivo, plano
 * pensando-como-empresa-com-agile-beaver.md).
 *
 * NÃO é um método a mais em `PrismaService` — tentei isso primeiro e não
 * funciona: dentro de `PrismaService.$transaction(fn)`, o Prisma re-deriva
 * um client interativo do MESMO tipo subclassado internamente, e como o
 * construtor de `PrismaService` SEMPRE retorna o Proxy (nunca a instância
 * nua — ver `create-tenant-aware-proxy.ts`), esse client de transação
 * "herda" estruturalmente todos os métodos customizados de `PrismaService`
 * (incluindo um hipotético `runOutsideTransaction`). Isso faz a checagem
 * `prop in activeContext` do Proxy enxergar esse método como "presente" na
 * transação ambiente e rotear a chamada pra lá — onde `$transaction` nativo
 * não existe de verdade (Postgres/Prisma não suportam transação aninhada),
 * quebrando com `TypeError: this.$transaction is not a function`.
 * Confirmado empiricamente com uma reprodução isolada antes desta classe
 * existir. A única forma robusta de ter uma transação genuinamente
 * independente é um client Prisma que nunca passa por aquele Proxy em
 * primeiro lugar.
 */
@Injectable()
export class PrismaOutOfBandService implements OnModuleInit, OnModuleDestroy {
  private readonly client: PrismaClient;

  constructor(configService: ConfigService<Env, true>) {
    // Mesma role restrita que PrismaService usa (nunca DATABASE_URL, que
    // bypassa RLS) — ver infra/docker/init/02-app-role.sql.
    this.client = new PrismaClient({
      datasources: { db: { url: configService.get('DATABASE_URL_APP', { infer: true }) } },
    });
  }

  async onModuleInit(): Promise<void> {
    await this.client.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }

  /**
   * Seta `app.current_org_id` explicitamente na transação nova (mesmo
   * padrão de `TenantContextInterceptor`/`withTenantContext` do worker) —
   * sem isso, RLS cairia no fallback "sem contexto" documentado em
   * enable_row_level_security. `organizationId` explícito no `data` de cada
   * INSERT continua sendo a defesa em profundidade de sempre.
   */
  runOutsideTransaction<T>(
    organizationId: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.client.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_org_id', ${organizationId}, true)`;
        return fn(tx);
      },
      { timeout: 10_000 },
    );
  }
}
