import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { OUTREACH_SEND_RECONCILE_QUEUE, type OutreachSendReconcileJobData } from '@opsmind/shared-types';
import type { Env } from '@opsmind/config/env/schema';
import { NotificationsService } from '../notifications/notifications.service';
import { OutreachDispatchService } from './outreach-dispatch.service';

// Reconcilia envios SEND_UNKNOWN. Quem enfileira é o tick do worker; o cliente
// do provedor vive aqui na API. Sem confirmação, OWNER/ADMIN são avisados.
@Injectable()
export class OutreachSendReconcileConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutreachSendReconcileConsumer.name);
  private readonly connection: IORedis;
  private worker: Worker<OutreachSendReconcileJobData> | undefined;

  constructor(
    private readonly configService: ConfigService<Env, true>,
    private readonly dispatchService: OutreachDispatchService,
    private readonly notificationsService: NotificationsService,
  ) {
    this.connection = new IORedis(this.configService.get('REDIS_URL', { infer: true }), {
      maxRetriesPerRequest: null,
    });
  }

  onModuleInit(): void {
    this.worker = new Worker<OutreachSendReconcileJobData>(OUTREACH_SEND_RECONCILE_QUEUE, (job) => this.process(job), {
      connection: this.connection,
      concurrency: 1,
    });
    this.worker.on('failed', (job, error) => {
      this.logger.error(`reconciliação de envio falhou (messageId=${job?.data.messageId}): ${error.message}`);
    });
  }

  async process(job: Job<OutreachSendReconcileJobData>): Promise<void> {
    const { organizationId, messageId } = job.data;
    const outcome = await this.dispatchService.reconcile(organizationId, messageId);
    if (outcome === 'STILL_UNKNOWN') {
      // Um aviso por mensagem: as próximas tentativas não repetem a notificação.
      await this.notificationsService.notifyAdminsOnce(organizationId, 'outreach.send_unknown', { messageId }, 'messageId');
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    this.connection.disconnect();
  }
}
