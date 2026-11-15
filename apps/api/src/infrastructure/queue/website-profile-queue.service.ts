import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { WEBSITE_PROFILE_QUEUE, type WebsiteProfileJobData } from '@opsmind/shared-types';
import type { Env } from '@opsmind/config/env/schema';

/**
 * Produtor da fila `website-profile` — espelha `LeadScrapeQueueService`
 * quase exatamente. Usado por `POST .../leads/:leadId/investigate` e, mais
 * adiante, pela tool de IA `investigate_company_website`; o consumidor real
 * roda em `apps/worker` (`website-profiler-processor.ts`). Ver
 * docs/planning/2026-11-06-harvey-inteligencia-comercial.md §5.
 *
 * Conexão Redis própria, mesma justificativa de `LeadScrapeQueueService`: o
 * BullMQ trava a versão exata do `ioredis` que aceita como `connection`.
 */
@Injectable()
export class WebsiteProfileQueueService implements OnModuleDestroy {
  private readonly connection: IORedis;
  private readonly queue: Queue<WebsiteProfileJobData>;

  constructor(configService: ConfigService<Env, true>) {
    this.connection = new IORedis(configService.get('REDIS_URL', { infer: true }), {
      maxRetriesPerRequest: null,
    });
    this.queue = new Queue<WebsiteProfileJobData>(WEBSITE_PROFILE_QUEUE, {
      connection: this.connection,
    });
  }

  enqueue(data: WebsiteProfileJobData): Promise<unknown> {
    return this.queue.add('investigate', data);
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
    this.connection.disconnect();
  }
}
