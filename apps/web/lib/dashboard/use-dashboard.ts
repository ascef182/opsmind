'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api-client';

// Espelha DashboardOverview de apps/api/src/modules/dashboard/dashboard.service.ts —
// sem pacote compartilhado de DTOs de resposta ainda (só @opsmind/shared-types
// para input/domínio), então mantido local ao front por enquanto.
export interface ActivityLogItem {
  id: string;
  type: string;
  actorType: string;
  actorId: string | null;
  customerId: string;
  createdAt: string;
}

export interface DashboardOverview {
  customers: {
    total: number;
    byStatus: Record<'LEAD' | 'ACTIVE' | 'INACTIVE', number>;
    inactiveByRule: number;
  };
  tasks: {
    total: number;
    byStatus: Record<'OPEN' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED', number>;
  };
  recentActivity: ActivityLogItem[];
}

export function useDashboard(organizationId: string) {
  return useQuery({
    queryKey: ['organizations', organizationId, 'dashboard'],
    queryFn: () => apiFetch<DashboardOverview>(`/organizations/${organizationId}/dashboard`),
    enabled: Boolean(organizationId),
  });
}
