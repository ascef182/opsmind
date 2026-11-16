import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { OUTREACH_AUTODRAFT_QUEUE, type OutreachAutodraftJobData } from '@opsmind/shared-types';
import type { Env } from '@opsmind/config/env/schema';

/**
 * Produtor da fila `outreach-autodraft` — espelha `WebsiteProfileQueueService`.
 * Usado pelo gatilho de qualificação de `LeadsService.score()`; o consumidor
 * roda em `apps/worker` (`lead-scrape-processor.ts` também produz nesta fila).
 *
 * Conexão Redis própria, mesma justificativa de `LeadScrapeQueueService`: o
 * BullMQ trava a versão exata do `ioredis` que aceita como `connection`.
 */
@Injectable()
export class OutreachAutodraftQueueService implements OnModuleDestroy {
  private readonly connection: IORedis;
  private readonly queue: Queue<OutreachAutodraftJobData>;

  constructor(configService: ConfigService<Env, true>) {
    this.connection = new IORedis(configService.get('REDIS_URL', { infer: true }), {
      maxRetriesPerRequest: null,
    });
    this.queue = new Queue<OutreachAutodraftJobData>(OUTREACH_AUTODRAFT_QUEUE, {
      connection: this.connection,
    });
  }

  enqueue(data: OutreachAutodraftJobData): Promise<unknown> {
    return this.queue.add('draft', data);
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
    this.connection.disconnect();
  }
}
