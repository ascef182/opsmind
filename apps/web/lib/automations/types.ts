// Espelha os models Automation/AutomationRun de apps/api (@opsmind/database)
// — mesma decisão de lib/customers/types.ts: tipos duplicados localmente ao
// front em vez de importados do Prisma.
import type { Role } from '@opsmind/shared-types';

export const WRITE_ROLES: Role[] = ['OWNER', 'ADMIN', 'MANAGER', 'MEMBER'];

export type AutomationTrigger = 'CUSTOMER_INACTIVE' | 'DEAL_STAGE_STALE' | 'DEAL_SILENT_FOR';
export type AutomationRunStatus = 'SUCCESS' | 'FAILED' | 'SKIPPED';

export const AUTOMATION_TRIGGER_LABELS: Record<AutomationTrigger, string> = {
  CUSTOMER_INACTIVE: 'Cliente inativo',
  DEAL_STAGE_STALE: 'Negócio parado na etapa',
  DEAL_SILENT_FOR: 'Cliente sem atividade (negócio)',
};

// Único campo numérico de `conditions` que cada trigger aceita — espelha
// `CONDITION_NUMERIC_FIELD` de apps/api/.../automations.service.ts (a mesma
// validação de range do PATCH/POST olha só esse campo).
export const AUTOMATION_CONDITION_FIELD: Record<AutomationTrigger, { key: string; label: string; unit: string }> = {
  CUSTOMER_INACTIVE: { key: 'inactiveForDays', label: 'Dias sem atividade', unit: 'dias' },
  DEAL_STAGE_STALE: { key: 'thresholdHoursOverride', label: 'Horas na etapa', unit: 'horas' },
  DEAL_SILENT_FOR: { key: 'silentForDays', label: 'Dias sem atividade do cliente', unit: 'dias' },
};

export interface Automation {
  id: string;
  organizationId: string;
  name: string;
  trigger: AutomationTrigger;
  conditions: Record<string, unknown>;
  actions: { createTask?: boolean; notify?: boolean };
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationRun {
  id: string;
  automationId: string;
  customerId: string | null;
  dealId: string | null;
  status: AutomationRunStatus;
  result: Record<string, unknown> | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface CreateAutomationInput {
  name: string;
  trigger: AutomationTrigger;
  conditions?: Record<string, unknown>;
  actions: { createTask?: boolean; notify?: boolean };
  enabled?: boolean;
}

// `trigger` fica de fora deliberadamente — espelha UpdateAutomationInput de
// apps/api/.../automations.service.ts (mudar o tipo de uma automação sob o
// mesmo histórico de execução não é suportado).
export type UpdateAutomationInput = Partial<Omit<CreateAutomationInput, 'trigger'>>;

// Resposta de `POST .../:automationId/run` (automations.controller.ts) —
// nunca devolve a Automation, só a contagem enfileirada.
export interface RunAutomationNowResult {
  enqueued: number;
}
