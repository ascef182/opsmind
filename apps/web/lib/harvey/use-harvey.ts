'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import type { Campaign, CampaignPatch, HarveyActivity, HarveyCommand, HarveySnapshot } from './types';

export const harveyKey = (organizationId: string, ...rest: unknown[]) => [
  'organizations',
  organizationId,
  'harvey',
  ...rest,
];

export interface ActivityFilters {
  phase?: string;
  status?: string;
  leadId?: string;
}

export function useHarveySnapshot(organizationId: string) {
  return useQuery({
    queryKey: harveyKey(organizationId, 'snapshot'),
    queryFn: () => apiFetch<HarveySnapshot>(`/organizations/${organizationId}/revenue/harvey`),
    enabled: Boolean(organizationId),
  });
}

export function useHarveyActivities(organizationId: string, filters: ActivityFilters) {
  return useInfiniteQuery({
    queryKey: harveyKey(organizationId, 'activities', filters),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      if (pageParam) params.set('cursor', pageParam);
      for (const [name, value] of Object.entries(filters)) if (value) params.set(name, value);
      return apiFetch<{ items: HarveyActivity[]; nextCursor: string | null }>(
        `/organizations/${organizationId}/revenue/harvey/activities?${params.toString()}`,
      );
    },
    getNextPageParam: (page) => page.nextCursor,
    enabled: Boolean(organizationId),
  });
}

export function useHarveyCommand(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { command: HarveyCommand; reason?: string }) =>
      apiFetch<HarveySnapshot>(`/organizations/${organizationId}/revenue/harvey/commands`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: (snapshot) => {
      queryClient.setQueryData(harveyKey(organizationId, 'snapshot'), snapshot);
      void queryClient.invalidateQueries({ queryKey: harveyKey(organizationId, 'activities') });
    },
  });
}

export function useCampaigns(organizationId: string) {
  return useQuery({
    queryKey: harveyKey(organizationId, 'campaigns'),
    queryFn: () => apiFetch<Campaign[]>(`/organizations/${organizationId}/revenue/campaigns`),
    enabled: Boolean(organizationId),
  });
}

export function useUpdateCampaign(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: CampaignPatch }) =>
      apiFetch<Campaign>(`/organizations/${organizationId}/revenue/campaigns/${id}`, { method: 'PATCH', body: patch }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: harveyKey(organizationId, 'campaigns') });
      void queryClient.invalidateQueries({ queryKey: harveyKey(organizationId, 'snapshot') });
    },
  });
}
