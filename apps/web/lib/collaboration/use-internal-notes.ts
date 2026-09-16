'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import type { CreateNoteInput, InternalNote } from './types';

export function useDealNotes(organizationId: string, dealId: string) {
  return useQuery({
    queryKey: ['organizations', organizationId, 'deals', dealId, 'notes'],
    queryFn: () => apiFetch<InternalNote[]>(`/organizations/${organizationId}/deals/${dealId}/notes`),
    enabled: Boolean(organizationId) && Boolean(dealId),
  });
}

export function useCreateDealNote(organizationId: string, dealId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateNoteInput) =>
      apiFetch<InternalNote>(`/organizations/${organizationId}/deals/${dealId}/notes`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['organizations', organizationId, 'deals', dealId, 'notes'] }),
  });
}

export function useLeadNotes(organizationId: string, leadId: string) {
  return useQuery({
    queryKey: ['organizations', organizationId, 'leads', leadId, 'notes'],
    queryFn: () => apiFetch<InternalNote[]>(`/organizations/${organizationId}/leads/${leadId}/notes`),
    enabled: Boolean(organizationId) && Boolean(leadId),
  });
}

export function useCreateLeadNote(organizationId: string, leadId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateNoteInput) =>
      apiFetch<InternalNote>(`/organizations/${organizationId}/leads/${leadId}/notes`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['organizations', organizationId, 'leads', leadId, 'notes'] }),
  });
}
