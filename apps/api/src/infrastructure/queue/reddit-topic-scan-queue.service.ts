import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { REDDIT_TOPIC_SCAN_QUEUE, type RedditTopicScanJobData } from '@opsmind/shared-types';
import type { Env } from '@opsmind/config/env/schema';

/**
 * Produtor da fila `reddit-topic-scan` — espelha `LeadScrapeQueueService`
 * quase exatamente (mesma pasta). Usado por
 * `POST .../reddit-watch-topics/:id/scan-now` e por
 * `RedditWatchTopicsService.create()` (scan imediato ao criar um tópico
 * ativo); o consumidor real roda em `apps/worker`
 * (`reddit-topic-scan-processor.ts`).
 */
@Injectable()
export class RedditTopicScanQueueService implements OnModuleDestroy {
  private readonly connection: IORedis;
  private readonly queue: Queue<RedditTopicScanJobData>;

  constructor(configService: ConfigService<Env, true>) {
    this.connection = new IORedis(configService.get('REDIS_URL', { infer: true }), {
      maxRetriesPerRequest: null,
    });
    this.queue = new Queue<RedditTopicScanJobData>(REDDIT_TOPIC_SCAN_QUEUE, {
      connection: this.connection,
    });
  }

  enqueue(data: RedditTopicScanJobData): Promise<unknown> {
    return this.queue.add('scan', data);
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
    this.connection.disconnect();
  }
}
