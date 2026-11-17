import type { HarveyJobTrigger } from './harvey';
import type { SocialLink } from './social-link.types';

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
  // Rascunho automático é sempre AUTOMATIC hoje; o campo existe para um pedido
  // manual futuro pela fila não depender do estado do Harvey.
  trigger?: HarveyJobTrigger;
}

/**
 * Resolve o canal de outreach do gatilho automático (B4/Task 11) por
 * prioridade fixa — WHATSAPP > INSTAGRAM_DM > LINKEDIN_DM > EMAIL > PHONE,
 * primeiro campo preenchido — a partir do `Lead` já persistido (pós-
 * `upsertLead`). `PHONE` é a prioridade mais baixa (ruling pós-review,
 * substitui a decisão original desta função): dado real de seed mostra
 * bastante negócio só-com-telefone, que sem este tier nunca ganharia
 * rascunho automático nenhum — `OutreachChannel` já suporta `PHONE`, então
 * não há razão pra deixar esses leads de fora. `null` só quando NENHUM dos
 * cinco campos está preenchido — o chamador trata `null` como "sem canal
 * elegível", nunca força um canal fora desta lista.
 *
 * Compartilhada entre `apps/worker` (`website-profiler-processor.ts`, que decide o canal
 * do autodraft disparado DEPOIS da investigação de site) e `apps/api` (gatilho de
 * qualificação) — a prioridade de canal vive em um lugar só, sem duplicação.
 */
export function resolveAutodraftChannel(lead: {
  whatsapp: string | null;
  email: string | null;
  phone: string | null;
  socialLinks: unknown;
}): OutreachChannel | null {
  if (lead.whatsapp) {
    return 'WHATSAPP';
  }
  const socialLinks = Array.isArray(lead.socialLinks) ? (lead.socialLinks as unknown as SocialLink[]) : [];
  if (socialLinks.some((link) => link?.platform === 'INSTAGRAM')) {
    return 'INSTAGRAM_DM';
  }
  if (socialLinks.some((link) => link?.platform === 'LINKEDIN')) {
    return 'LINKEDIN_DM';
  }
  if (lead.email) {
    return 'EMAIL';
  }
  if (lead.phone) {
    return 'PHONE';
  }
  return null;
}
