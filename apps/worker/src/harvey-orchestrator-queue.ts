import { Queue, Worker, type Processor } from 'bullmq';
import type IORedis from 'ioredis';
import {
  HARVEY_ORCHESTRATOR_QUEUE,
  NON_RETRYABLE_JOB_OPTIONS,
  OUTREACH_SEND_RECONCILE_QUEUE,
  type HarveyTickJobData,
  type OutreachSendReconcileJobData,
} from '@opsmind/shared-types';

export const HARVEY_TICK_INTERVAL_MS = 60_000;

export function createHarveyOrchestratorQueue(connection: IORedis): Queue<HarveyTickJobData> {
  return new Queue<HarveyTickJobData>(HARVEY_ORCHESTRATOR_QUEUE, {
    connection,
    defaultJobOptions: NON_RETRYABLE_JOB_OPTIONS,
  });
}

// Concorrência 1: ticks nunca se sobrepõem dentro de um processo; entre
// réplicas, o scheduler do BullMQ entrega cada repetição a um único worker e a
// trava por organização no Postgres cobre o tick sob demanda.
export function createHarveyOrchestratorWorker(
  connection: IORedis,
  processor: Processor<HarveyTickJobData>,
): Worker<HarveyTickJobData> {
  return new Worker<HarveyTickJobData>(HARVEY_ORCHESTRATOR_QUEUE, processor, { connection, concurrency: 1 });
}

// Schedulers idempotentes (upsert): várias réplicas registrando o mesmo id
// resultam num único agendamento.
export async function registerHarveySchedulers(
  queue: Queue<HarveyTickJobData>,
  followupIntervalMs: number,
): Promise<void> {
  await queue.upsertJobScheduler('harvey-tick', { every: HARVEY_TICK_INTERVAL_MS }, { name: 'tick', data: {} });
  await queue.upsertJobScheduler('outreach-followup', { every: followupIntervalMs }, { name: 'followup', data: {} });
}

export function createSendReconcileQueue(connection: IORedis): Queue<OutreachSendReconcileJobData> {
  return new Queue<OutreachSendReconcileJobData>(OUTREACH_SEND_RECONCILE_QUEUE, {
    connection,
    defaultJobOptions: NON_RETRYABLE_JOB_OPTIONS,
  });
}
