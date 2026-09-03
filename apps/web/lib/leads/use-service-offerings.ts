'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import type { CreateServiceOfferingInput, ServiceOffering, UpdateServiceOfferingInput } from './types';

function queryString(isActive?: boolean): string {
  if (isActive === undefined) return '';
  return `?isActive=${isActive}`;
}

export function useServiceOfferings(organizationId: string, isActive?: boolean) {
  return useQuery({
    queryKey: ['organizations', organizationId, 'service-offerings', { isActive }],
    queryFn: () =>
      apiFetch<ServiceOffering[]>(`/organizations/${organizationId}/service-offerings${queryString(isActive)}`),
    enabled: Boolean(organizationId),
  });
}

export function useServiceOffering(organizationId: string, offeringId: string) {
  return useQuery({
    queryKey: ['organizations', organizationId, 'service-offerings', offeringId],
    queryFn: () =>
      apiFetch<ServiceOffering>(`/organizations/${organizationId}/service-offerings/${offeringId}`),
    enabled: Boolean(organizationId) && Boolean(offeringId),
  });
}

export function useCreateServiceOffering(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateServiceOfferingInput) =>
      apiFetch<ServiceOffering>(`/organizations/${organizationId}/service-offerings`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['organizations', organizationId, 'service-offerings'] }),
  });
}

export function useUpdateServiceOffering(organizationId: string, offeringId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateServiceOfferingInput) =>
      apiFetch<ServiceOffering>(`/organizations/${organizationId}/service-offerings/${offeringId}`, {
        method: 'PATCH',
        body: input,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['organizations', organizationId, 'service-offerings'] }),
  });
}

export function useRemoveServiceOffering(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (offeringId: string) =>
      apiFetch<void>(`/organizations/${organizationId}/service-offerings/${offeringId}`, { method: 'DELETE' }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['organizations', organizationId, 'service-offerings'] }),
  });
}
