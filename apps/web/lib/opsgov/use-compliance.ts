'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import { opsgovRoot } from './use-company';
import type { Certificate, CreateCertificateInput, CreateObligationInput, Obligation } from './types';

const base = (organizationId: string) => `/organizations/${organizationId}/opsgov/compliance`;
const key = (organizationId: string) => [...opsgovRoot(organizationId), 'compliance'] as const;

export function useObligations(organizationId: string) {
  return useQuery({
    queryKey: [...key(organizationId), 'obligations'],
    queryFn: () => apiFetch<Obligation[]>(`${base(organizationId)}/obligations`),
    enabled: Boolean(organizationId),
  });
}

export function useCertificates(organizationId: string) {
  return useQuery({
    queryKey: [...key(organizationId), 'certificates'],
    queryFn: () => apiFetch<Certificate[]>(`${base(organizationId)}/certificates`),
    enabled: Boolean(organizationId),
  });
}

function useComplianceMutation<TInput, TResult>(organizationId: string, request: (input: TInput) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key(organizationId) }),
  });
}

export function useCreateObligation(organizationId: string) {
  return useComplianceMutation(organizationId, (input: CreateObligationInput) =>
    apiFetch<Obligation>(`${base(organizationId)}/obligations`, { method: 'POST', body: input }),
  );
}

export function useCompleteObligation(organizationId: string) {
  return useComplianceMutation(organizationId, ({ id, completedOn }: { id: string; completedOn?: string }) =>
    apiFetch<Obligation>(`${base(organizationId)}/obligations/${id}/complete`, { method: 'POST', body: { completedOn } }),
  );
}

export function useDismissObligation(organizationId: string) {
  return useComplianceMutation(organizationId, ({ id, reason }: { id: string; reason: string }) =>
    apiFetch<Obligation>(`${base(organizationId)}/obligations/${id}/dismiss`, { method: 'POST', body: { reason } }),
  );
}

export function useCreateCertificate(organizationId: string) {
  return useComplianceMutation(organizationId, (input: CreateCertificateInput) =>
    apiFetch<Certificate>(`${base(organizationId)}/certificates`, { method: 'POST', body: input }),
  );
}
