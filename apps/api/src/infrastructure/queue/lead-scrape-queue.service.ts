import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { LEAD_SCRAPE_QUEUE, type LeadScrapeJobData } from '@opsmind/shared-types';
import type { Env } from '@opsmind/config/env/schema';

/**
 * Produtor da fila `lead-scrape` — espelha `AutomationQueueService` (mesmo
 * arquivo/pasta) quase exatamente. Usado pelo endpoint que dispara um
 * `ScrapeJob` (ex.: `POST .../scrape-jobs`); o consumidor real roda em
 * `apps/worker` (`lead-scrape-processor.ts`).
 *
 * Conexão Redis própria, separada de `RedisService` (BudgetService de IA,
 * Fase 3): mesma justificativa de `AutomationQueueService` — o BullMQ trava
 * a versão exata do `ioredis` que aceita como `connection` (5.11.1, ver
 * `apps/worker/src/queue.ts`), diferente do `ioredis@^6` já usado pelo
 * resto da API. Isolado aqui em vez de forçar todo o app numa versão só.
 */
@Injectable()
export class LeadScrapeQueueService implements OnModuleDestroy {
  private readonly connection: IORedis;
  private readonly queue: Queue<LeadScrapeJobData>;

  constructor(configService: ConfigService<Env, true>) {
    this.connection = new IORedis(configService.get('REDIS_URL', { infer: true }), {
      maxRetriesPerRequest: null,
    });
    this.queue = new Queue<LeadScrapeJobData>(LEAD_SCRAPE_QUEUE, {
      connection: this.connection,
    });
  }

  enqueue(data: LeadScrapeJobData): Promise<unknown> {
    return this.queue.add('scrape', data);
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
    this.connection.disconnect();
  }
}
