// Espelha os models Customer/ActivityLog de apps/api (@opsmind/database) —
// sem pacote compartilhado de DTOs de resposta ainda, mantido local ao front
// (mesma decisão de lib/dashboard/use-dashboard.ts).
import type { Role } from '@opsmind/shared-types';

// Espelha WRITE_ROLES de apps/api/src/shared/constants/roles.constant.ts —
// mesma duplicação já feita em lib/deals/types.ts e lib/leads/types.ts.
export const WRITE_ROLES: Role[] = ['OWNER', 'ADMIN', 'MANAGER', 'MEMBER'];

export type CustomerStatus = 'LEAD' | 'ACTIVE' | 'INACTIVE';

export interface Customer {
  id: string;
  organizationId: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  status: CustomerStatus;
  tags: string[];
  ownerUserId: string | null;
  lastActivityAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ActivityLogEntry {
  id: string;
  type: string;
  actorType: string;
  actorId: string | null;
  payload: Record<string, unknown> | null;
  createdAt: string;
}

export interface CreateCustomerInput {
  name: string;
  company?: string;
  email?: string;
  phone?: string;
  status?: CustomerStatus;
  tags?: string[];
}

export interface UpdateCustomerInput {
  name?: string;
  company?: string;
  email?: string;
  phone?: string;
  status?: CustomerStatus;
  tags?: string[];
}

export interface ListCustomersFilter {
  status?: CustomerStatus;
  search?: string;
}
