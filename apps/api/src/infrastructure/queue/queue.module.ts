import { Module } from '@nestjs/common';
import { LeadScrapeQueueService } from './lead-scrape-queue.service';
import { RedditTopicScanQueueService } from './reddit-topic-scan-queue.service';
import { WebsiteProfileQueueService } from './website-profile-queue.service';

/**
 * Módulo do novo produtor de fila BullMQ `lead-scrape`
 * (`apps/worker/src/lead-scrape-processor.ts` é quem consome) — a ser
 * importado pelo módulo de leads (endpoint que dispara um `ScrapeJob`,
 * ainda não implementado nesta branch) quando existir.
 *
 * Deliberadamente NÃO registra `AutomationQueueService` aqui: essa classe já
 * é provider de `AutomationsModule` (`apps/api/src/modules/automations/
 * automations.module.ts`), e módulos Nest instanciam um provider por
 * container de DI em que ele é declarado — se `AutomationQueueService`
 * também fosse provider deste módulo, o dia em que algo importasse
 * `QueueModule` criaria uma SEGUNDA instância independente dela (conexão
 * IORedis própria + client BullMQ próprio, duplicando a conexão real ao
 * Redis) coexistindo com a de `AutomationsModule`, em vez de reusar a
 * mesma. Consolidar os dois produtores num módulo só de fato é trabalho
 * futuro (mexeria em `AutomationsModule`, fora do escopo desta tarefa) —
 * por ora, cada produtor vive no módulo que o expõe hoje.
 */
@Module({
  providers: [LeadScrapeQueueService, RedditTopicScanQueueService, WebsiteProfileQueueService],
  exports: [LeadScrapeQueueService, RedditTopicScanQueueService, WebsiteProfileQueueService],
})
export class QueueModule {}
