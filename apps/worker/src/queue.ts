import { Queue, Worker, type Processor } from 'bullmq';
import IORedis from 'ioredis';
import { AUTOMATION_EXECUTION_QUEUE, type AutomationExecutionJobData } from '@opsmind/shared-types';

/** BullMQ exige `maxRetriesPerRequest: null` pros comandos bloqueantes (BRPOPLPUSH/BLMOVE) funcionarem. */
export function createRedisConnection(redisUrl: string): IORedis {
  return new IORedis(redisUrl, { maxRetriesPerRequest: null });
}

export function createAutomationQueue(connection: IORedis): Queue<AutomationExecutionJobData> {
  return new Queue<AutomationExecutionJobData>(AUTOMATION_EXECUTION_QUEUE, {
    connection,
    // Mesma higiene de `AutomationQueueService` (apps/api) — os dois
    // produtores da fila precisam concordar, senão o comportamento de
    // retenção depende de qual processo criou a Queue primeiro.
    defaultJobOptions: {
      removeOnComplete: { count: 500 },
      removeOnFail: { count: 500 },
    },
  });
}

export function createAutomationWorker(
  connection: IORedis,
  processor: Processor<AutomationExecutionJobData>,
): Worker<AutomationExecutionJobData> {
  return new Worker<AutomationExecutionJobData>(AUTOMATION_EXECUTION_QUEUE, processor, { connection });
}
