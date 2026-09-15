// Espelha o model Deal de apps/api (@opsmind/database) — mesma decisão de
// lib/customers/types.ts e lib/leads/types.ts: tipos duplicados localmente
// ao front em vez de importados do Prisma.
import type { Role } from '@opsmind/shared-types';

// Espelha WRITE_ROLES de apps/api/src/shared/constants/roles.constant.ts —
// mesma duplicação já feita em lib/leads/types.ts.
export const WRITE_ROLES: Role[] = ['OWNER', 'ADMIN', 'MANAGER', 'MEMBER'];

export type DealStage = 'QUALIFICATION' | 'PROPOSAL' | 'NEGOTIATION' | 'CONTRACT_SENT' | 'WON' | 'LOST';

export const DEAL_STAGES: DealStage[] = [
  'QUALIFICATION',
  'PROPOSAL',
  'NEGOTIATION',
  'CONTRACT_SENT',
  'WON',
  'LOST',
];

export const DEAL_STAGE_LABELS: Record<DealStage, string> = {
  QUALIFICATION: 'Qualificação',
  PROPOSAL: 'Proposta',
  NEGOTIATION: 'Negociação',
  CONTRACT_SENT: 'Contrato enviado',
  WON: 'Ganho',
  LOST: 'Perdido',
};

// Espelha ALLOWED_TRANSITIONS de apps/api/src/modules/deals/deals.service.ts
// — usado só pra desenhar o `<Select>` de "mover para..." com as opções
// válidas a partir do estágio atual; a validação de verdade continua sendo
// feita no backend (esta lista é só uma conveniência de UI, nunca a fonte da
// verdade de segurança).
export const DEAL_STAGE_TRANSITIONS: Record<DealStage, DealStage[]> = {
  QUALIFICATION: ['PROPOSAL', 'NEGOTIATION', 'WON', 'LOST'],
  PROPOSAL: ['QUALIFICATION', 'NEGOTIATION', 'CONTRACT_SENT', 'WON', 'LOST'],
  NEGOTIATION: ['PROPOSAL', 'CONTRACT_SENT', 'WON', 'LOST'],
  CONTRACT_SENT: ['NEGOTIATION', 'WON', 'LOST'],
  WON: [],
  LOST: ['QUALIFICATION'],
};

export interface Deal {
  id: string;
  organizationId: string;
  customerId: string;
  originLeadId: string | null;
  title: string;
  stage: DealStage;
  // `Decimal` do Prisma serializa como STRING no JSON de resposta — mesma
  // observação já feita em lib/leads/types.ts pra `Lead.rating`.
  value: string;
  currency: string;
  expectedCloseDate: string | null;
  actualCloseDate: string | null;
  ownerUserId: string | null;
  lostReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDealInput {
  customerId: string;
  title: string;
  value: number;
  currency?: string;
  expectedCloseDate?: string;
}

export interface UpdateDealInput {
  title?: string;
  value?: number;
  currency?: string;
  expectedCloseDate?: string;
}

export interface MoveDealStageInput {
  stage: DealStage;
  lostReason?: string;
}

export interface ListDealsFilter {
  stage?: DealStage;
  customerId?: string;
  ownerUserId?: string;
  search?: string;
}

// `value` chega como string (ver comentário em `Deal.value` acima) — aceita
// tanto essa string quanto um number já calculado (painéis de dashboard
// somam vários deals e devolvem number).
export function formatCurrency(value: string | number, currency = 'BRL'): string {
  const amount = typeof value === 'string' ? Number(value) : value;
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(amount);
  } catch {
    // `currency` fora do padrão ISO 4217 (entrada livre no formulário) —
    // Intl.NumberFormat lança RangeError; cai num formato legível sem
    // travar a página.
    return `${currency} ${amount.toFixed(2)}`;
  }
}
