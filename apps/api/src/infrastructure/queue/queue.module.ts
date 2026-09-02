import { Module } from '@nestjs/common';
import { AutomationQueueService } from './automation-queue.service';
import { LeadScrapeQueueService } from './lead-scrape-queue.service';

/**
 * Módulo compartilhado dos produtores de fila BullMQ da API.
 *
 * `AutomationsModule` já registra `AutomationQueueService` como provider
 * próprio (criado antes deste módulo existir) — deixado como está por não
 * ser parte desta tarefa (Task 4 do plano de leads/prospecção) mexer nele;
 * os dois providers convivem sem conflito (módulos Nest têm containers de
 * DI independentes, cada um instancia sua própria conexão Redis).
 *
 * `LeadScrapeQueueService` é o novo produtor da fila `lead-scrape`
 * (`apps/worker/src/lead-scrape-processor.ts` é quem consome) — exportado
 * aqui para o módulo de leads (endpoint que dispara um `ScrapeJob`, ainda
 * não implementado nesta branch) importar quando existir.
 */
@Module({
  providers: [AutomationQueueService, LeadScrapeQueueService],
  exports: [AutomationQueueService, LeadScrapeQueueService],
})
export class QueueModule {}
