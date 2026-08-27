import type { AuditActorType } from './audit.types';

// Nome da fila BullMQ (PRD §12) — compartilhado entre apps/api (produtor:
// disparo manual via POST .../automations/:id/run) e apps/worker (consumidor
// + o scan periódico que enfileira automaticamente). Uma constante única
// evita o nome da fila divergir silenciosamente entre os dois processos.
export const AUTOMATION_EXECUTION_QUEUE = 'automation-execution';

/**
 * Payload de um job de execução de automação. `organizationId` sempre
 * presente (PRD §12: "cada job carrega organization_id obrigatoriamente" —
 * evita um worker processar/vazar dado de tenant errado por engano).
 */
export interface AutomationExecutionJobData {
  organizationId: string;
  automationId: string;
  customerId: string;
  actorType: AuditActorType;
  actorId?: string;
}
