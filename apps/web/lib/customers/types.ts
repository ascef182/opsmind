// Espelha os models Customer/ActivityLog de apps/api (@opsmind/database) —
// sem pacote compartilhado de DTOs de resposta ainda, mantido local ao front
// (mesma decisão de lib/dashboard/use-dashboard.ts).
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
