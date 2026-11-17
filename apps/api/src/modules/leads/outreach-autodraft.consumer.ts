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
import { getEngineBudgetStatus } from '@opsmind/database';
import type { Env } from '@opsmind/config/env/schema';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { OutreachService } from './outreach.service';
import { AiRefusalException } from '../ai/services/ai-one-shot-runner';

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
 * relança, deixando o retry da fila agir (rede instável, erro transitório do
 * gateway de IA, etc.; `AUTODRAFT_JOB_OPTIONS` em @opsmind/shared-types) —
 * isso só passou a ter efeito de verdade depois do fix de `attempts`/`backoff`
 * (review final, Harvey Fase 7):
 * antes disso o default do BullMQ (`attempts: 1`) fazia qualquer relance
 * aqui ser, na prática, código morto — o job simplesmente ia pra `failed`
 * sem nenhuma segunda tentativa.
 */
@Injectable()
export class OutreachAutodraftConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutreachAutodraftConsumer.name);
  private readonly connection: IORedis;
  private worker: Worker<OutreachAutodraftJobData> | undefined;

  constructor(
    private readonly configService: ConfigService<Env, true>,
    private readonly outreachService: OutreachService,
    private readonly prisma: PrismaService,
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

    // Guarda contra rollback (Fix 2 do review final, Harvey Fase 7): este
    // job é enfileirado DENTRO da transação de request de `score()`. Se essa
    // transação nunca commitar (ex.: a AI tool `score_lead` roda no meio de
    // uma chamada de chat com múltiplas tool calls que depois lança ou
    // atinge `MAX_ITERATIONS`), o job já está sentado no Redis mas o status
    // QUALIFIED do lead nunca existiu de fato no Postgres. Reconfirma contra
    // o banco antes de gastar orçamento de IA gerando um rascunho pra um
    // lead que, pelo estado real do banco, nunca qualificou. Filtro
    // explícito por `organizationId` na query (defesa em profundidade, ver
    // seção de multi-tenancy do CLAUDE.md) — este consumer roda fora de
    // qualquer transação de request, sem contexto de RLS pra confiar.
    //
    // CORREÇÃO sobre a primeira versão deste guard (regressão Critical
    // encontrada no re-review): a versão anterior pulava permanentemente na
    // primeira leitura que não achasse QUALIFIED. Só que o Worker BullMQ
    // deste processo pega o job poucos milissegundos depois do enqueue —
    // quase sempre ANTES da transação de `score()` commitar, então a
    // primeira leitura quase sempre vê a linha pré-commit (ainda
    // DISCOVERED/etc.), não um rollback de verdade. Pra `score_lead` via AI
    // tool (transação fica aberta por várias iterações de chat/chamadas de
    // IA) isso matava o gatilho quase sempre; pro caminho REST/`enrich()`
    // era um cara-ou-coroa. Uma transação ainda não commitada e uma
    // genuinamente revertida são INDISTINGUÍVEIS numa única leitura — a
    // única forma de diferenciar é dar tempo (retry com backoff, ver
    // `OutreachAutodraftQueueService.enqueue()`) antes de desistir de
    // verdade.
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId, organizationId } });
    if (!lead || lead.status !== 'QUALIFIED') {
      const attemptsMade = job.attemptsMade ?? 0;
      const maxAttempts = job.opts.attempts ?? 1;
      // Dentro do `process()`, `job.attemptsMade` ainda reflete as tentativas
      // JÁ CONCLUÍDAS antes desta (o BullMQ só incrementa esse contador —
      // no Redis e depois no objeto em memória — quando a tentativa atual
      // termina, sucesso ou falha). Então a tentativa atual é a de número
      // `attemptsMade + 1`; é a última permitida quando esse número alcança
      // `maxAttempts`.
      const isFinalAttempt = attemptsMade + 1 >= maxAttempts;
      if (!isFinalAttempt) {
        // Relança (sem `return`) pra deixar o BullMQ reagendar com backoff —
        // dá tempo real pra transação de `score()` commitar antes de tratar
        // isso como rollback de verdade.
        throw new Error(
          `lead ainda não está QUALIFIED no banco (organizationId=${organizationId}, leadId=${leadId}) — ` +
            `status atual: "${lead?.status ?? 'não encontrado'}", tentativa ${attemptsMade + 1} de ${maxAttempts}`,
        );
      }
      this.logger.warn(
        `rascunho automático de outreach pulado (organizationId=${organizationId}, leadId=${leadId}) — ` +
          `status final do lead no banco é "${lead?.status ?? 'não encontrado'}", não QUALIFIED após ${maxAttempts} ` +
          'tentativas — tratando como rollback/não-qualificação de verdade',
      );
      return;
    }

    // Teto mensal do Revenue Engine: rascunho automático é gasto autônomo e
    // para quando o teto estoura (um humano ainda pode gerar manualmente).
    if ((await getEngineBudgetStatus(this.prisma, organizationId)).exceeded) {
      this.logger.warn(
        `rascunho automático de outreach pulado (organizationId=${organizationId}, leadId=${leadId}) — teto mensal do Revenue Engine atingido`,
      );
      return;
    }

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
      if (error instanceof AiRefusalException) {
        // A mesma entrada tende a ser recusada de novo: retentar só pagaria
        // cada tentativa outra vez. Um humano gera o rascunho manualmente.
        this.logger.warn(
          `rascunho automático de outreach recusado pela IA (organizationId=${organizationId}, leadId=${leadId})`,
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
