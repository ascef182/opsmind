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
  // Só preenchido pelos dois triggers de Deal (`DEAL_STAGE_STALE`/
  // `DEAL_SILENT_FOR`, radar de risco do funil ativo, 2026-11-14) — o
  // trigger `CUSTOMER_INACTIVE` nunca o preenche.
  dealId?: string;
  actorType: AuditActorType;
  actorId?: string;
}

// dealId tem precedência: um cliente pode ter vários deals sob a mesma
// automação. Delimitador `_`, não `:` — BullMQ (job.js, validateOptions)
// rejeita um jobId customizado que contenha `:` fora do formato interno de
// job repetível (reservado pra sua própria estrutura de chave Redis
// `bull:<queue>:<jobId>`); confirmado batendo contra Redis real no e2e
// (apps/worker/test/automation.e2e-spec.ts) antes de aceitar esta função.
export function automationJobId(data: AutomationExecutionJobData): string {
  return `${data.automationId}_${data.dealId ?? data.customerId}`;
}
