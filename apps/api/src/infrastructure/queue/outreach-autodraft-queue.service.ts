import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { OUTREACH_AUTODRAFT_QUEUE, type OutreachAutodraftJobData, AUTODRAFT_JOB_OPTIONS } from '@opsmind/shared-types';
import type { Env } from '@opsmind/config/env/schema';

/**
 * Produtor da fila `outreach-autodraft` — espelha `WebsiteProfileQueueService`.
 * Usado pelo gatilho de qualificação de `LeadsService.score()`; o consumidor
 * roda em `apps/worker` (`lead-scrape-processor.ts` também produz nesta fila).
 *
 * Conexão Redis própria, mesma justificativa de `LeadScrapeQueueService`: o
 * BullMQ trava a versão exata do `ioredis` que aceita como `connection`.
 */
@Injectable()
export class OutreachAutodraftQueueService implements OnModuleDestroy {
  private readonly connection: IORedis;
  private readonly queue: Queue<OutreachAutodraftJobData>;

  constructor(configService: ConfigService<Env, true>) {
    this.connection = new IORedis(configService.get('REDIS_URL', { infer: true }), {
      maxRetriesPerRequest: null,
    });
    this.queue = new Queue<OutreachAutodraftJobData>(OUTREACH_AUTODRAFT_QUEUE, {
      connection: this.connection,
      defaultJobOptions: AUTODRAFT_JOB_OPTIONS,
    });
  }

  enqueue(data: OutreachAutodraftJobData): Promise<unknown> {
    // `attempts`/`backoff` (Fix do review final sobre a regressão do Fix 2
    // de uma rodada anterior, Harvey Fase 7): `OutreachAutodraftConsumer`
    // reconfirma `Lead.status === 'QUALIFIED'` direto no banco antes de
    // gerar o rascunho, porque este job é enfileirado DENTRO da transação de
    // request de `score()` — no caso comum o consumer processa o job
    // milissegundos depois do enqueue, ainda ANTES da transação commitar, e
    // vê a linha pré-commit (ainda não QUALIFIED). Sem retry, isso
    // praticamente mata o gatilho pra qualquer transação que não commite
    // instantaneamente (o caso comum da AI tool `score_lead`, cuja transação
    // só commita depois de várias iterações de chat/chamadas de IA). Default
    // do BullMQ é `attempts: 1` (sem retry nenhum) — 6 tentativas com backoff
    // exponencial a partir de 2s (2s, 4s, 8s, 16s, 32s entre tentativas, ~62s
    // de janela total) dá tempo de sobra pro caminho comum (REST/`enrich()`,
    // commit quase imediato) e pra maioria das durações de chat com IA,
    // enquanto ainda desiste eventualmente de um rollback de verdade. Risco
    // residual aceito: um chat com IA patologicamente longo (muitas
    // iterações de tool call) ainda pode exceder essa janela e perder o
    // autodraft — risco limitado, não algo que este fix precise eliminar.
    // Tentativas/backoff vêm de `AUTODRAFT_JOB_OPTIONS` na própria fila.
    return this.queue.add('draft', data);
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
    this.connection.disconnect();
  }
}
