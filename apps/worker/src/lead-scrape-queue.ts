import { Queue, Worker, type Processor } from 'bullmq';
import type IORedis from 'ioredis';
import { LEAD_SCRAPE_QUEUE, type LeadScrapeJobData } from '@opsmind/shared-types';

/**
 * Mesmo padrão de `queue.ts` (fila de automations) — `createRedisConnection`
 * de lá já cobre a conexão compartilhada (`maxRetriesPerRequest: null`,
 * exigido pelo BullMQ pros comandos bloqueantes); esta fila reaproveita essa
 * mesma conexão em `main.ts`, não cria a sua própria.
 */
export function createLeadScrapeQueue(connection: IORedis): Queue<LeadScrapeJobData> {
  return new Queue<LeadScrapeJobData>(LEAD_SCRAPE_QUEUE, { connection });
}

export function createLeadScrapeWorker(
  connection: IORedis,
  processor: Processor<LeadScrapeJobData>,
): Worker<LeadScrapeJobData> {
  return new Worker<LeadScrapeJobData>(LEAD_SCRAPE_QUEUE, processor, { connection });
}
