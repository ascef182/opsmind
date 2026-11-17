import { Queue } from 'bullmq';
import type IORedis from 'ioredis';
import { OUTREACH_AUTODRAFT_QUEUE, type OutreachAutodraftJobData, AUTODRAFT_JOB_OPTIONS } from '@opsmind/shared-types';

/**
 * Produtor da fila `outreach-autodraft` — metade PRODUTORA apenas (mesma
 * forma de `lead-scrape-queue.ts`, mas sem a metade consumidora: este
 * worker nunca processa jobs desta fila, só os enfileira a partir de
 * `lead-scrape-processor.ts`, logo depois de `upsertLead`, quando um lead
 * qualifica com pelo menos um canal de contato). Quem consome é
 * `apps/api` (`apps/api/src/modules/leads/outreach-autodraft.consumer.ts`)
 * — primeiro `Worker` BullMQ dentro do próprio `apps/api`, ver comentário de
 * topo daquele arquivo.
 *
 * Mesma conexão Redis compartilhada de `main.ts` (`createRedisConnection`,
 * `queue.ts`) — não cria a sua própria, mesmo racional de `lead-scrape-queue.ts`.
 */
export function createOutreachAutodraftQueue(connection: IORedis): Queue<OutreachAutodraftJobData> {
  return new Queue<OutreachAutodraftJobData>(OUTREACH_AUTODRAFT_QUEUE, { connection, defaultJobOptions: AUTODRAFT_JOB_OPTIONS });
}
