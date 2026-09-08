// Espelho do enum OutreachChannel do Prisma (packages/database/prisma/schema.prisma).
// Compartilhado entre apps/api e apps/worker (que não podem importar um do outro).
// Manter em sync com a definição no schema sempre que novos canais forem adicionados.
export type OutreachChannel = 'EMAIL' | 'PHONE' | 'WHATSAPP' | 'LINKEDIN_DM' | 'REDDIT_DM' | 'INSTAGRAM_DM' | 'OTHER';

// Nome da fila BullMQ para geração automática de rascunhos de outreach —
// compartilhada entre apps/worker (produtor: enfileira durante
// lead-scrape-processor.ts) e apps/api (consumidor: outreach-autodraft.consumer.ts
// processa e executa IA). Constante única evita o nome da fila divergir
// silenciosamente entre os dois processos (mesmo racional de LEAD_SCRAPE_QUEUE
// e AUTOMATION_EXECUTION_QUEUE).
export const OUTREACH_AUTODRAFT_QUEUE = 'outreach-autodraft';

/**
 * Payload de um job de geração automática de rascunho de mensagem de outreach.
 * Contém contexto mínimo necessário: o lead a que se aplica, o canal de
 * comunicação (EMAIL, WHATSAPP, LINKEDIN_DM, REDDIT_DM, INSTAGRAM_DM, etc.)
 * e opcionalmente qual serviço promover. `organizationId` sempre presente para
 * evitar o worker processar/vazar dado de tenant errado por engano (mesmo
 * padrão de LeadScrapeJobData e AutomationExecutionJobData).
 */
export interface OutreachAutodraftJobData {
  organizationId: string;
  leadId: string;
  channel: OutreachChannel;
  serviceOfferingId?: string;
}
