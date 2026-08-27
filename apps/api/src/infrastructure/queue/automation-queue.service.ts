import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { AUTOMATION_EXECUTION_QUEUE, type AutomationExecutionJobData } from '@opsmind/shared-types';
import type { Env } from '@opsmind/config/env/schema';

/**
 * Produtor da fila `automation-execution` (PRD §12) — usado só pelo disparo
 * manual (`POST .../automations/:id/run`); o scan periódico que enfileira
 * automaticamente roda em `apps/worker`, que também consome esta fila.
 *
 * Conexão Redis própria, separada de RedisService (BudgetService, Fase 3):
 * o BullMQ trava a versão exata do `ioredis` que aceita como `connection`
 * (5.11.1 — ver apps/worker/src/queue.ts), diferente do `ioredis@^6` já
 * usado pelo resto da API. Isolado aqui em vez de forçar todo o app numa
 * versão só.
 */
@Injectable()
export class AutomationQueueService implements OnModuleDestroy {
  private readonly connection: IORedis;
  private readonly queue: Queue<AutomationExecutionJobData>;

  constructor(configService: ConfigService<Env, true>) {
    this.connection = new IORedis(configService.get('REDIS_URL', { infer: true }), {
      maxRetriesPerRequest: null,
    });
    this.queue = new Queue<AutomationExecutionJobData>(AUTOMATION_EXECUTION_QUEUE, {
      connection: this.connection,
    });
  }

  enqueue(data: AutomationExecutionJobData): Promise<unknown> {
    return this.queue.add('execute', data);
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
    this.connection.disconnect();
  }
}
