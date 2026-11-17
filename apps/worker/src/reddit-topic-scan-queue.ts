import { Queue, Worker, type Processor } from 'bullmq';
import type IORedis from 'ioredis';
import { REDDIT_TOPIC_SCAN_QUEUE, type RedditTopicScanJobData, RETRYABLE_JOB_OPTIONS } from '@opsmind/shared-types';

/**
 * Mesmo padrão de `lead-scrape-queue.ts` — reaproveita a conexão Redis
 * compartilhada já criada em `main.ts` (`createRedisConnection`), não cria a
 * sua própria.
 */
export function createRedditTopicScanQueue(connection: IORedis): Queue<RedditTopicScanJobData> {
  return new Queue<RedditTopicScanJobData>(REDDIT_TOPIC_SCAN_QUEUE, { connection, defaultJobOptions: RETRYABLE_JOB_OPTIONS });
}

export function createRedditTopicScanWorker(
  connection: IORedis,
  processor: Processor<RedditTopicScanJobData>,
): Worker<RedditTopicScanJobData> {
  return new Worker<RedditTopicScanJobData>(REDDIT_TOPIC_SCAN_QUEUE, processor, { connection });
}
