'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import type { CreateSignalCodeInput, SignalCode } from './types';

export function useSignalCodes(organizationId: string) {
  return useQuery({
    queryKey: ['organizations', organizationId, 'signal-codes'],
    queryFn: () => apiFetch<SignalCode[]>(`/organizations/${organizationId}/signal-codes`),
    enabled: Boolean(organizationId),
  });
}

export function useProposeSignalCode(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSignalCodeInput) =>
      apiFetch<SignalCode>(`/organizations/${organizationId}/signal-codes`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['organizations', organizationId, 'signal-codes'] }),
  });
}

export function useConfirmSignalCode(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (code: string) =>
      apiFetch<SignalCode>(`/organizations/${organizationId}/signal-codes/${encodeURIComponent(code)}/confirm`, {
        method: 'POST',
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['organizations', organizationId, 'signal-codes'] }),
  });
}
