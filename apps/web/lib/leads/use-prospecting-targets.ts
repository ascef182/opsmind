'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import type {
  CreateProspectingTargetInput,
  ListProspectingTargetsFilter,
  ProspectingTarget,
  UpdateProspectingTargetInput,
} from './types';

function queryString(filter: ListProspectingTargetsFilter): string {
  if (filter.isActive === undefined) return '';
  return `?isActive=${filter.isActive}`;
}

export function useProspectingTargets(organizationId: string, filter: ListProspectingTargetsFilter = {}) {
  return useQuery({
    queryKey: ['organizations', organizationId, 'prospecting-targets', filter],
    queryFn: () =>
      apiFetch<ProspectingTarget[]>(
        `/organizations/${organizationId}/prospecting-targets${queryString(filter)}`,
      ),
    enabled: Boolean(organizationId),
  });
}

export function useCreateProspectingTarget(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProspectingTargetInput) =>
      apiFetch<ProspectingTarget>(`/organizations/${organizationId}/prospecting-targets`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['organizations', organizationId, 'prospecting-targets'] }),
  });
}

export function useUpdateProspectingTarget(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ targetId, input }: { targetId: string; input: UpdateProspectingTargetInput }) =>
      apiFetch<ProspectingTarget>(`/organizations/${organizationId}/prospecting-targets/${targetId}`, {
        method: 'PATCH',
        body: input,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['organizations', organizationId, 'prospecting-targets'] }),
  });
}

export function useRemoveProspectingTarget(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (targetId: string) =>
      apiFetch<void>(`/organizations/${organizationId}/prospecting-targets/${targetId}`, { method: 'DELETE' }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['organizations', organizationId, 'prospecting-targets'] }),
  });
}
