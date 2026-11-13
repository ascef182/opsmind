'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import type { ConvertedCustomer, ConvertLeadInput, CreateLeadInput, Lead, ListLeadsFilter, UpdateLeadInput } from './types';

function queryString(filter: ListLeadsFilter): string {
  const params = new URLSearchParams();
  if (filter.status) params.set('status', filter.status);
  if (filter.sourceType) params.set('sourceType', filter.sourceType);
  if (filter.minScore !== undefined) params.set('minScore', String(filter.minScore));
  if (filter.city) params.set('city', filter.city);
  if (filter.state) params.set('state', filter.state);
  if (filter.hasWebsite !== undefined) params.set('hasWebsite', String(filter.hasWebsite));
  if (filter.hasWhatsapp !== undefined) params.set('hasWhatsapp', String(filter.hasWhatsapp));
  if (filter.whatsappCandidate !== undefined) params.set('whatsappCandidate', String(filter.whatsappCandidate));
  if (filter.hasContactMethod !== undefined) params.set('hasContactMethod', String(filter.hasContactMethod));
  if (filter.search) params.set('search', filter.search);
  if (filter.scrapeJobId) params.set('scrapeJobId', filter.scrapeJobId);
  const query = params.toString();
  return query ? `?${query}` : '';
}

export function useLeads(organizationId: string, filter: ListLeadsFilter = {}) {
  return useQuery({
    queryKey: ['organizations', organizationId, 'leads', filter],
    queryFn: () => apiFetch<Lead[]>(`/organizations/${organizationId}/leads${queryString(filter)}`),
    enabled: Boolean(organizationId),
  });
}

export function useLead(organizationId: string, leadId: string) {
  return useQuery({
    queryKey: ['organizations', organizationId, 'leads', leadId],
    queryFn: () => apiFetch<Lead>(`/organizations/${organizationId}/leads/${leadId}`),
    enabled: Boolean(organizationId) && Boolean(leadId),
  });
}

export function useCreateLead(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateLeadInput) =>
      apiFetch<Lead>(`/organizations/${organizationId}/leads`, { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['organizations', organizationId, 'leads'] }),
  });
}

export function useUpdateLead(organizationId: string, leadId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateLeadInput) =>
      apiFetch<Lead>(`/organizations/${organizationId}/leads/${leadId}`, { method: 'PATCH', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['organizations', organizationId, 'leads'] }),
  });
}

// `POST .../leads/:leadId/score` — recalcula score/status a partir de
// `scoreLead()` (ver leads.service.ts); não recebe body.
export function useScoreLead(organizationId: string, leadId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<Lead>(`/organizations/${organizationId}/leads/${leadId}/score`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['organizations', organizationId, 'leads'] }),
  });
}

// `POST .../leads/discard-by-scrape-job` — descarte em lote (marca
// DISQUALIFIED, nunca um DELETE) de todos os leads pré-qualificação de uma
// busca específica. Ver LeadsService.discardByScrapeJob.
export function useDiscardLeadsByScrapeJob(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (scrapeJobId: string) =>
      apiFetch<{ count: number }>(`/organizations/${organizationId}/leads/discard-by-scrape-job`, {
        method: 'POST',
        body: { scrapeJobId },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['organizations', organizationId, 'leads'] }),
  });
}

// `POST .../leads/:leadId/assign` — reatribuição manual/explícita, sempre
// vence sobre o round-robin automático da criação (ver LeadsService.assign).
export function useAssignLead(organizationId: string, leadId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      apiFetch<Lead>(`/organizations/${organizationId}/leads/${leadId}/assign`, {
        method: 'POST',
        body: { userId },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['organizations', organizationId, 'leads'] }),
  });
}

// `POST .../leads/:leadId/convert` — promove o Lead a Customer. Invalida
// também a lista de customers (efeito colateral real da mutation: um
// Customer novo passa a existir) além do domínio de leads.
export function useConvertLead(organizationId: string, leadId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ConvertLeadInput) =>
      apiFetch<ConvertedCustomer>(`/organizations/${organizationId}/leads/${leadId}/convert`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organizations', organizationId, 'leads'] });
      queryClient.invalidateQueries({ queryKey: ['organizations', organizationId, 'customers'] });
    },
  });
}
