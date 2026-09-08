// Nome da fila BullMQ para clustering de tópicos do Reddit — compartilhada
// entre apps/worker (produtor: enfileira durante lead-scrape-processor.ts) e
// apps/api (consumidor: reddit-clustering.consumer.ts processa e executa IA).
// Constante única evita o nome da fila divergir silenciosamente entre os dois
// processos (mesmo racional de LEAD_SCRAPE_QUEUE e AUTOMATION_EXECUTION_QUEUE).
export const REDDIT_CLUSTERING_QUEUE = 'reddit-clustering';

/**
 * Payload de um job de clustering de tópicos do Reddit. Contém os posts
 * candidatos que serão agrupados por tema/comunidade para identificar
 * oportunidades de mercado. `organizationId` sempre presente para evitar o
 * worker processar/vazar dado de tenant errado por engano (mesmo padrão de
 * LeadScrapeJobData e AutomationExecutionJobData).
 */
export interface RedditClusteringJobData {
  organizationId: string;
  topicId: string;
  topicQuery: string;
  candidatePosts: Array<{
    url: string;
    title: string | null;
    textContent: string | null;
  }>;
}
