import { Queue } from 'bullmq';
import type IORedis from 'ioredis';
import { REDDIT_CLUSTERING_QUEUE, type RedditClusteringJobData } from '@opsmind/shared-types';

/**
 * Produtor da fila `reddit-clustering` — metade PRODUTORA apenas (mesma
 * forma de `outreach-autodraft-queue.ts`: este worker nunca processa jobs
 * desta fila, só os enfileira a partir de `reddit-mining-scan.ts`, quando o
 * scan periódico de `RedditWatchTopic`s ativos encontra posts candidatos via
 * Camoufox). Quem consome é `apps/api`
 * (`apps/api/src/modules/market-opportunities/reddit-clustering.consumer.ts`,
 * Task 12).
 *
 * Mesma conexão Redis compartilhada de `main.ts` (`createRedisConnection`,
 * `queue.ts`) — não cria a sua própria, mesmo racional de
 * `outreach-autodraft-queue.ts`/`lead-scrape-queue.ts`.
 */
export function createRedditClusteringQueue(connection: IORedis): Queue<RedditClusteringJobData> {
  return new Queue<RedditClusteringJobData>(REDDIT_CLUSTERING_QUEUE, { connection });
}
