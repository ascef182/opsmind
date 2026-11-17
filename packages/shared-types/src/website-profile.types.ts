import type { HarveyJobTrigger } from './harvey';
import type { AuditActorType } from './audit.types';

// Nome da fila BullMQ do profiler de site — compartilhada entre apps/api
// (produtor: `POST .../leads/:leadId/investigate` e, mais adiante, a tool
// de IA `investigate_company_website`) e apps/worker (consumidor,
// `website-profiler-processor.ts`). Mesmo racional de `LEAD_SCRAPE_QUEUE`
// (lead-scraping.types.ts): constante única evita o nome da fila divergir
// silenciosamente entre os dois processos.
export const WEBSITE_PROFILE_QUEUE = 'website-profile';

/**
 * Payload de um job de investigação de site — deliberadamente mínimo
 * (mesmo racional de `LeadScrapeJobData`): carrega só os IDs necessários
 * para o worker recarregar `Lead.website` do próprio banco no momento da
 * execução, nunca a URL copiada pro payload (evitaria, por exemplo,
 * investigar um site antigo se o lead for atualizado enquanto o job espera
 * na fila).
 */
export interface WebsiteProfileJobData {
  organizationId: string;
  leadId: string;
  actorType: AuditActorType;
  actorId?: string;
  // MANUAL = pedido explícito de uma pessoa (roda mesmo com o Harvey pausado).
  // Ausente em jobs antigos: deduzido de actorType (USER → MANUAL).
  trigger?: HarveyJobTrigger;
}
