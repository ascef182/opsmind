import { Queue, Worker, type Processor } from 'bullmq';
import type IORedis from 'ioredis';
import { WEBSITE_PROFILE_QUEUE, type WebsiteProfileJobData } from '@opsmind/shared-types';

// Mesmo padrão de `reddit-topic-scan-queue.ts`/`lead-scrape-queue.ts` —
// reaproveita a conexão Redis compartilhada já criada em `main.ts`
// (`createRedisConnection`), não cria a sua própria.
export function createWebsiteProfilerQueue(connection: IORedis): Queue<WebsiteProfileJobData> {
  return new Queue<WebsiteProfileJobData>(WEBSITE_PROFILE_QUEUE, { connection });
}

export function createWebsiteProfilerWorker(
  connection: IORedis,
  processor: Processor<WebsiteProfileJobData>,
): Worker<WebsiteProfileJobData> {
  return new Worker<WebsiteProfileJobData>(WEBSITE_PROFILE_QUEUE, processor, { connection });
}
