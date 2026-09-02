import type { AuditActorType } from './audit.types';

// Nome da fila BullMQ para scraping de leads — compartilhada entre apps/api
// (produtor: disparo manual de um ScrapeJob via endpoint) e apps/worker
// (consumidor: lead-scrape-processor.ts). Constante única evita o nome da
// fila divergir silenciosamente entre os dois processos (mesmo racional de
// AUTOMATION_EXECUTION_QUEUE em automation.types.ts).
export const LEAD_SCRAPE_QUEUE = 'lead-scrape';

/**
 * Payload de um job de scraping de leads. Deliberadamente mínimo: carrega só
 * os IDs necessários para o worker recarregar o `ScrapeJob` do próprio banco
 * (cidade/estado/tipo de negócio, fonte, filtros etc. vivem lá) — nunca os
 * parâmetros de busca em si. Um job na fila pode ficar esperando por horas;
 * confiar em parâmetros "velhos" copiados pro payload arriscaria o worker
 * rodar a busca com dados stale se o ScrapeJob for editado/cancelado nesse
 * meio-tempo. `organizationId` sempre presente pelo mesmo motivo de
 * AutomationExecutionJobData: evita o worker processar/vazar dado de tenant
 * errado por engano.
 */
export interface LeadScrapeJobData {
  organizationId: string;
  scrapeJobId: string;
  actorType: AuditActorType;
  actorId?: string;
}
