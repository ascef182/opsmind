// REGRA DURA — ESTE CONSUMER SÓ PODE CHAMAR `outreachService.generateDraft`:
// nunca `approve`, `reject`, `regenerate`, `markSent` ou `markReplied`. Isso
// é deliberado, mesmo espírito do aviso em
// `apps/api/src/modules/ai/tools/generate-outreach-message.tool.ts`: o único
// caminho para `OutreachMessage.status` sair de `DRAFT` é um endpoint humano
// dedicado (`POST .../outreach-messages/:id/approve` etc., protegido por
// `RolesGuard`) — nunca a IA, e nunca este processo automático disparado por
// evento de scraping. `generateDraft` sempre grava em `DRAFT`; este consumer
// não avança o status sozinho, nem tem como (não injeta `OutreachService`
// além do que `generateDraft` expõe aqui). Antes de "completar" este arquivo
// com uma chamada de aprovação/envio "para simetria" ou "conveniência", pare
// e trate como uma preocupação a reportar, não como trabalho a fazer.
//
// Primeiro `Worker` BullMQ dentro do próprio `apps/api` (Task 11) — até aqui
// `apps/api` só tinha produtores de fila (`LeadScrapeQueueService`,
// `AutomationQueueService`); quem consumia era sempre `apps/worker`. Este é
// o primeiro caso em que o próprio processo da API roda um consumer BullMQ,
// porque `generateDraft` precisa do `AiGateway`/`BudgetService`/etc. já
// registrados no módulo `leads` de `apps/api`, e duplicar esse serviço
// inteiro em `apps/worker` (que não pode importar `apps/api`, ver
// `packages/integrations` no CLAUDE.md) seria pior do que a API rodar um
// consumer próprio para esta fila.
import { Injectable, Logger, OnModuleDestroy, OnModuleInit, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { OUTREACH_AUTODRAFT_QUEUE, type OutreachAutodraftJobData } from '@opsmind/shared-types';
import type { Env } from '@opsmind/config/env/schema';
import { OutreachService } from './outreach.service';

/**
 * Consumer BullMQ da fila `outreach-autodraft` — gerada por
 * `apps/worker/src/lead-scrape-processor.ts` logo após um lead qualificar
 * com pelo menos um canal de contato (B4/Task 11, ver comentário lá).
 * Gestão de ciclo de vida de conexão Redis (`onModuleInit`/`onModuleDestroy`)
 * espelha `LeadScrapeQueueService`
 * (`apps/api/src/infrastructure/queue/lead-scrape-queue.service.ts`) —
 * mesma conexão isolada (não `RedisService`, mesma justificativa de versão
 * do `ioredis` travada pelo BullMQ), mesmas opções (`maxRetriesPerRequest:
 * null`), mesmo `close()`/`disconnect()` no destroy.
 *
 * `ForbiddenException` (orçamento mensal de IA estourado, lançado por
 * `OutreachService.generateDraft`) resolve o job SEM relançar — não faz
 * sentido o BullMQ retentar antes do próximo mês. Qualquer outro erro
 * relança, deixando o retry padrão do BullMQ agir (rede instável, erro
 * transitório do gateway de IA, etc.).
 */
@Injectable()
export class OutreachAutodraftConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutreachAutodraftConsumer.name);
  private readonly connection: IORedis;
  private worker: Worker<OutreachAutodraftJobData> | undefined;

  constructor(
    private readonly configService: ConfigService<Env, true>,
    private readonly outreachService: OutreachService,
  ) {
    this.connection = new IORedis(this.configService.get('REDIS_URL', { infer: true }), {
      maxRetriesPerRequest: null,
    });
  }

  onModuleInit(): void {
    this.worker = new Worker<OutreachAutodraftJobData>(
      OUTREACH_AUTODRAFT_QUEUE,
      (job) => this.process(job),
      { connection: this.connection },
    );

    this.worker.on('failed', (job, error) => {
      this.logger.error(
        `job de rascunho automático de outreach falhou (jobId=${job?.id}, leadId=${job?.data.leadId}): ${error.message}`,
        error.stack,
      );
    });
  }

  private async process(job: Job<OutreachAutodraftJobData>): Promise<void> {
    const { organizationId, leadId, channel, serviceOfferingId } = job.data;
    try {
      await this.outreachService.generateDraft(
        organizationId,
        leadId,
        { channel, serviceOfferingId },
        { type: 'SYSTEM' },
      );
    } catch (error) {
      if (error instanceof ForbiddenException) {
        // Orçamento mensal de IA estourado — não relança: retentar não
        // ajudaria até o orçamento resetar no mês seguinte. Job resolve
        // normalmente (sem gerar rascunho nenhum desta vez).
        this.logger.warn(
          `rascunho automático de outreach pulado (organizationId=${organizationId}, leadId=${leadId}) — orçamento mensal de IA estourado`,
        );
        return;
      }
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    this.connection.disconnect();
  }
}
