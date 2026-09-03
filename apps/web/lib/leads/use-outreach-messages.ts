'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import type {
  GenerateOutreachInput,
  ListOutreachMessagesFilter,
  OutreachMessage,
  RejectOutreachInput,
} from './types';

function queryString(filter: ListOutreachMessagesFilter): string {
  const params = new URLSearchParams();
  if (filter.status) params.set('status', filter.status);
  const query = params.toString();
  return query ? `?${query}` : '';
}

// Thread de outreach de UM lead — `GET .../leads/:leadId/outreach-messages`.
export function useOutreachMessagesForLead(organizationId: string, leadId: string) {
  return useQuery({
    queryKey: ['organizations', organizationId, 'leads', leadId, 'outreach-messages'],
    queryFn: () =>
      apiFetch<OutreachMessage[]>(`/organizations/${organizationId}/leads/${leadId}/outreach-messages`),
    enabled: Boolean(organizationId) && Boolean(leadId),
  });
}

// Fila de aprovação global — `GET .../outreach-messages?status=`, default
// nenhum filtro aplicado aqui (a página decide o default DRAFT).
export function useOutreachMessages(organizationId: string, filter: ListOutreachMessagesFilter = {}) {
  return useQuery({
    queryKey: ['organizations', organizationId, 'outreach-messages', filter],
    queryFn: () =>
      apiFetch<OutreachMessage[]>(`/organizations/${organizationId}/outreach-messages${queryString(filter)}`),
    enabled: Boolean(organizationId),
  });
}

export function useOutreachMessage(organizationId: string, messageId: string) {
  return useQuery({
    queryKey: ['organizations', organizationId, 'outreach-messages', messageId],
    queryFn: () =>
      apiFetch<OutreachMessage>(`/organizations/${organizationId}/outreach-messages/${messageId}`),
    enabled: Boolean(organizationId) && Boolean(messageId),
  });
}

// Invalida tudo que uma transição de OutreachMessage pode ter afetado: a
// thread do lead (novo estado da mensagem), o Lead em si (várias transições
// também avançam `Lead.status` — ver outreach.service.ts) e a fila global
// (a mensagem pode ter saído/entrado do filtro `?status=DRAFT` de
// outreach/page.tsx). Mesmo padrão de `useAddNote` em use-customers.ts:
// invalidação por prefixo largo, não por chave exata.
function invalidateOutreachDomain(
  queryClient: ReturnType<typeof useQueryClient>,
  organizationId: string,
  leadId: string,
) {
  queryClient.invalidateQueries({ queryKey: ['organizations', organizationId, 'leads', leadId] });
  queryClient.invalidateQueries({ queryKey: ['organizations', organizationId, 'outreach-messages'] });
}

export function useGenerateOutreachDraft(organizationId: string, leadId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: GenerateOutreachInput) =>
      apiFetch<OutreachMessage>(`/organizations/${organizationId}/leads/${leadId}/outreach-messages`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => invalidateOutreachDomain(queryClient, organizationId, leadId),
  });
}

export function useApproveOutreach(organizationId: string, leadId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) =>
      apiFetch<OutreachMessage>(`/organizations/${organizationId}/outreach-messages/${messageId}/approve`, {
        method: 'POST',
      }),
    onSuccess: () => invalidateOutreachDomain(queryClient, organizationId, leadId),
  });
}

export function useRejectOutreach(organizationId: string, leadId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ messageId, ...input }: RejectOutreachInput & { messageId: string }) =>
      apiFetch<OutreachMessage>(`/organizations/${organizationId}/outreach-messages/${messageId}/reject`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => invalidateOutreachDomain(queryClient, organizationId, leadId),
  });
}

export function useRegenerateOutreach(organizationId: string, leadId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) =>
      apiFetch<OutreachMessage>(`/organizations/${organizationId}/outreach-messages/${messageId}/regenerate`, {
        method: 'POST',
      }),
    onSuccess: () => invalidateOutreachDomain(queryClient, organizationId, leadId),
  });
}

export function useMarkOutreachSent(organizationId: string, leadId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) =>
      apiFetch<OutreachMessage>(`/organizations/${organizationId}/outreach-messages/${messageId}/mark-sent`, {
        method: 'POST',
      }),
    onSuccess: () => invalidateOutreachDomain(queryClient, organizationId, leadId),
  });
}

export function useMarkOutreachReplied(organizationId: string, leadId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) =>
      apiFetch<OutreachMessage>(`/organizations/${organizationId}/outreach-messages/${messageId}/mark-replied`, {
        method: 'POST',
      }),
    onSuccess: () => invalidateOutreachDomain(queryClient, organizationId, leadId),
  });
}
