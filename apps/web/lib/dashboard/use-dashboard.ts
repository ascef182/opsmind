'use client';

import { useQuery } from '@tanstack/react-query';
import type { LeadScoreBreakdown } from '@opsmind/shared-types';
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

// Espelha `LeadPipelineOverview` de
// apps/api/src/modules/dashboard/dashboard.service.ts (Task 9) — mesma
// decisão de tipos duplicados ao front que `DashboardOverview` acima e
// `lib/leads/types.ts`.
export type LeadStatus =
  | 'DISCOVERED'
  | 'QUALIFIED'
  | 'DISQUALIFIED'
  | 'OUTREACH_DRAFTED'
  | 'OUTREACH_APPROVED'
  | 'CONTACTED'
  | 'REPLIED'
  | 'CONVERTED'
  | 'LOST';

export type ScrapeJobStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export interface LeadPipelineLead {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  website: string | null;
  status: LeadStatus;
  score: number | null;
  scoreBreakdown: LeadScoreBreakdown | null;
  discoveredAt: string;
}

export interface LeadPipelineScrapeJob {
  id: string;
  status: ScrapeJobStatus;
  city: string;
  state: string;
  businessType: string;
  leadsFound: number;
  createdAt: string;
}

export interface LeadsByCityBucket {
  city: string | null;
  state: string | null;
  count: number;
  withoutWebsite: number;
}

export interface LeadsByDayPoint {
  date: string;
  total: number;
  withoutWebsite: number;
}

export interface LeadPipelineOverview {
  totalLeads: number;
  leadsWithoutWebsite: number;
  qualificationRate: number;
  leadsByStatus: Record<LeadStatus, number>;
  leadsByCity: LeadsByCityBucket[];
  leadsByDay: LeadsByDayPoint[];
  recentLeads: LeadPipelineLead[];
  recentScrapeJobs: LeadPipelineScrapeJob[];
}

export function useLeadPipelineOverview(organizationId: string) {
  return useQuery({
    queryKey: ['organizations', organizationId, 'dashboard', 'leads'],
    queryFn: () => apiFetch<LeadPipelineOverview>(`/organizations/${organizationId}/dashboard/leads`),
    enabled: Boolean(organizationId),
  });
}

// Espelha `DealPipelineOverview` de
// apps/api/src/modules/dashboard/dashboard.service.ts (plano
// pensando-como-empresa-com-agile-beaver.md) — mesma decisão de tipos
// duplicados ao front que `LeadPipelineOverview` acima.
export type DealStage = 'QUALIFICATION' | 'PROPOSAL' | 'NEGOTIATION' | 'CONTRACT_SENT' | 'WON' | 'LOST';

export interface DealStageBucket {
  count: number;
  value: number;
}

export interface DealPipelineDeal {
  id: string;
  title: string;
  stage: DealStage;
  value: string;
  currency: string;
  customerId: string;
  expectedCloseDate: string | null;
  actualCloseDate: string | null;
}

export interface DealPipelineOverview {
  openValue: number;
  dealsByStage: Record<DealStage, DealStageBucket>;
  winRate: number;
  avgSalesCycleDays: number | null;
  dealsClosingSoon: DealPipelineDeal[];
  recentlyWonDeals: DealPipelineDeal[];
}

export function useDealPipelineOverview(organizationId: string) {
  return useQuery({
    queryKey: ['organizations', organizationId, 'dashboard', 'deals'],
    queryFn: () => apiFetch<DealPipelineOverview>(`/organizations/${organizationId}/dashboard/deals`),
    enabled: Boolean(organizationId),
  });
}
