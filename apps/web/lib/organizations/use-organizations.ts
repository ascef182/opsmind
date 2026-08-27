'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateOrganizationInput, OrganizationDto } from '@opsmind/shared-types';
import { apiFetch } from '../api-client';

export function useOrganizations() {
  return useQuery({
    queryKey: ['organizations'],
    queryFn: () => apiFetch<OrganizationDto[]>('/organizations'),
  });
}

export function useOrganization(organizationId: string) {
  return useQuery({
    queryKey: ['organizations', organizationId],
    queryFn: () => apiFetch<OrganizationDto>(`/organizations/${organizationId}`),
    enabled: Boolean(organizationId),
  });
}

export function useCreateOrganization() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateOrganizationInput) =>
      apiFetch<OrganizationDto>('/organizations', { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['organizations'] }),
  });
}
