import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { HARVEY_ORCHESTRATOR_QUEUE, NON_RETRYABLE_JOB_OPTIONS, type HarveyTickJobData } from '@opsmind/shared-types';
import type { Env } from '@opsmind/config/env/schema';

// Produtor de ticks sob demanda (após Iniciar/Retomar), para o Harvey reagir
// sem esperar o próximo tick periódico do worker.
@Injectable()
export class HarveyOrchestratorQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(HarveyOrchestratorQueueService.name);
  private readonly connection: IORedis;
  private readonly queue: Queue<HarveyTickJobData>;

  constructor(configService: ConfigService<Env, true>) {
    this.connection = new IORedis(configService.get('REDIS_URL', { infer: true }), {
      maxRetriesPerRequest: null,
    });
    this.queue = new Queue<HarveyTickJobData>(HARVEY_ORCHESTRATOR_QUEUE, {
      connection: this.connection,
      defaultJobOptions: NON_RETRYABLE_JOB_OPTIONS,
    });
  }

  async requestTick(organizationId: string): Promise<void> {
    try {
      await this.queue.add('tick', { organizationId }, { deduplication: { id: `tick:${organizationId}` } });
    } catch (error) {
      // O tick periódico cobre a falha; o comando já foi gravado.
      this.logger.warn(`Falha ao pedir tick imediato: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
    this.connection.disconnect();
  }
}
