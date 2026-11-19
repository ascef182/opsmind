'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import type { Campaign } from '@/lib/harvey/types';
import type {
  CampaignAction,
  CampaignLeadRow,
  CampaignLeadsFilter,
  CampaignMessage,
  CampaignOverview,
  CampaignOverviewFilter,
  CampaignWithStats,
  DuplicateCandidate,
  LeadParticipation,
  Paginated,
} from './types';

function toQuery(filter: object): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filter)) {
    if (value !== undefined && value !== '' && value !== null) params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

const base = (organizationId: string) => `/organizations/${organizationId}/revenue/campaigns`;
const key = (organizationId: string, ...rest: unknown[]) => ['organizations', organizationId, 'campaigns', ...rest];

export function useCampaignOverview(organizationId: string, filter: CampaignOverviewFilter) {
  return useQuery({
    queryKey: key(organizationId, 'overview', filter),
    queryFn: () => apiFetch<CampaignOverview>(`${base(organizationId)}/overview${toQuery(filter)}`),
    enabled: Boolean(organizationId),
    placeholderData: keepPreviousData,
  });
}

export function useCampaignDetail(organizationId: string, campaignId: string) {
  return useQuery({
    queryKey: key(organizationId, campaignId),
    queryFn: () => apiFetch<CampaignWithStats>(`${base(organizationId)}/${campaignId}`),
    enabled: Boolean(organizationId && campaignId),
  });
}

export function useCampaignLeads(organizationId: string, campaignId: string, filter: CampaignLeadsFilter) {
  return useQuery({
    queryKey: key(organizationId, campaignId, 'leads', filter),
    queryFn: () =>
      apiFetch<Paginated<CampaignLeadRow>>(`${base(organizationId)}/${campaignId}/leads${toQuery(filter)}`),
    enabled: Boolean(organizationId && campaignId),
    placeholderData: keepPreviousData,
  });
}

export function useCampaignMessages(organizationId: string, campaignId: string, status: string, page: number) {
  return useQuery({
    queryKey: key(organizationId, campaignId, 'messages', status, page),
    queryFn: () =>
      apiFetch<Paginated<CampaignMessage>>(
        `${base(organizationId)}/${campaignId}/outreach-messages${toQuery({ status, page })}`,
      ),
    enabled: Boolean(organizationId && campaignId),
    placeholderData: keepPreviousData,
  });
}

export function useCreateCampaign(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { segment: string; city: string; state: string; name?: string; sources?: string[] }) =>
      apiFetch<Campaign>(base(organizationId), { method: 'POST', body }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: key(organizationId) }),
  });
}

export function useRenameCampaign(organizationId: string, campaignId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => apiFetch<Campaign>(`${base(organizationId)}/${campaignId}`, { method: 'PATCH', body: { name } }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: key(organizationId) }),
  });
}

export function useCampaignAction(organizationId: string, campaignId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (action: CampaignAction) =>
      apiFetch<Campaign>(`${base(organizationId)}/${campaignId}/${action}`, { method: 'POST' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: key(organizationId) });
      void queryClient.invalidateQueries({ queryKey: ['organizations', organizationId, 'harvey'] });
    },
  });
}

export function useDuplicateCandidates(organizationId: string, campaignId?: string) {
  return useQuery({
    queryKey: ['organizations', organizationId, 'lead-duplicates', campaignId ?? 'all'],
    queryFn: () =>
      apiFetch<DuplicateCandidate[]>(`/organizations/${organizationId}/lead-duplicates${toQuery({ campaignId })}`),
    enabled: Boolean(organizationId),
  });
}

export function useReviewDuplicate(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ candidateId, decision, duplicateLeadId }: { candidateId: string; decision: 'confirm' | 'dismiss'; duplicateLeadId?: string }) =>
      apiFetch<unknown>(`/organizations/${organizationId}/lead-duplicates/${candidateId}/${decision}`, {
        method: 'POST',
        body: decision === 'confirm' ? { duplicateLeadId } : undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['organizations', organizationId, 'lead-duplicates'] });
      void queryClient.invalidateQueries({ queryKey: key(organizationId) });
    },
  });
}

export function useLeadParticipations(organizationId: string, leadId: string) {
  return useQuery({
    queryKey: ['organizations', organizationId, 'leads', leadId, 'campaigns'],
    queryFn: () => apiFetch<LeadParticipation[]>(`/organizations/${organizationId}/leads/${leadId}/campaigns`),
    enabled: Boolean(organizationId && leadId),
  });
}
