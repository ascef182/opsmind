'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import { opsgovRoot } from './use-company';
import type { AccountingDecision, AccountingProposal, ProposalInput } from './types';

const base = (organizationId: string) => `/organizations/${organizationId}/opsgov/accounting`;
const key = (organizationId: string) => [...opsgovRoot(organizationId), 'accounting'] as const;

export function useProposals(organizationId: string, enabled = true) {
  return useQuery({
    queryKey: [...key(organizationId), 'proposals'],
    queryFn: () => apiFetch<AccountingProposal[]>(`${base(organizationId)}/proposals`),
    enabled: Boolean(organizationId) && enabled,
  });
}

export function useDecisions(organizationId: string) {
  return useQuery({
    queryKey: [...key(organizationId), 'decisions'],
    queryFn: () => apiFetch<AccountingDecision[]>(`${base(organizationId)}/decisions`),
    enabled: Boolean(organizationId),
  });
}

function useAccountingMutation<TInput, TResult>(organizationId: string, request: (input: TInput) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key(organizationId) }),
  });
}

export function useSaveProposal(organizationId: string) {
  return useAccountingMutation(organizationId, ({ id, ...input }: ProposalInput & { id?: string }) =>
    id
      ? apiFetch<AccountingProposal>(`${base(organizationId)}/proposals/${id}`, { method: 'PATCH', body: input })
      : apiFetch<AccountingProposal>(`${base(organizationId)}/proposals`, { method: 'POST', body: input }),
  );
}

export function useDeleteProposal(organizationId: string) {
  return useAccountingMutation(organizationId, (id: string) =>
    apiFetch<void>(`${base(organizationId)}/proposals/${id}`, { method: 'DELETE' }),
  );
}

export function useLoadDefaultDecisions(organizationId: string) {
  return useAccountingMutation(organizationId, () =>
    apiFetch<{ created: number }>(`${base(organizationId)}/decisions/defaults`, { method: 'POST' }),
  );
}

export function useCreateDecision(organizationId: string) {
  return useAccountingMutation(organizationId, (input: { topic: string; question: string }) =>
    apiFetch<AccountingDecision>(`${base(organizationId)}/decisions`, { method: 'POST', body: input }),
  );
}

export function useAnswerDecision(organizationId: string) {
  return useAccountingMutation(organizationId, ({ id, ...body }: { id: string; text: string; author?: string }) =>
    apiFetch<AccountingDecision>(`${base(organizationId)}/decisions/${id}/answers`, { method: 'POST', body }),
  );
}

export function useDecide(organizationId: string) {
  return useAccountingMutation(organizationId, ({ id, finalDecision }: { id: string; finalDecision: string }) =>
    apiFetch<AccountingDecision>(`${base(organizationId)}/decisions/${id}/decide`, { method: 'POST', body: { finalDecision } }),
  );
}

export function useReopenDecision(organizationId: string) {
  return useAccountingMutation(organizationId, (id: string) =>
    apiFetch<AccountingDecision>(`${base(organizationId)}/decisions/${id}/status`, { method: 'POST', body: { status: 'EM_ANALISE' } }),
  );
}
