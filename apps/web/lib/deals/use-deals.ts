'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from '../api-client';
import { getStoredTokens } from '../auth/token-storage';
import { env } from '../env';
import type {
  CreateDealInput,
  Deal,
  DealSignatureRequest,
  ListDealsFilter,
  MoveDealStageInput,
  UpdateDealInput,
} from './types';

function queryString(filter: ListDealsFilter): string {
  const params = new URLSearchParams();
  if (filter.stage) params.set('stage', filter.stage);
  if (filter.customerId) params.set('customerId', filter.customerId);
  if (filter.ownerUserId) params.set('ownerUserId', filter.ownerUserId);
  if (filter.search) params.set('search', filter.search);
  const query = params.toString();
  return query ? `?${query}` : '';
}

export function useDeals(organizationId: string, filter: ListDealsFilter = {}) {
  return useQuery({
    queryKey: ['organizations', organizationId, 'deals', filter],
    queryFn: () => apiFetch<Deal[]>(`/organizations/${organizationId}/deals${queryString(filter)}`),
    enabled: Boolean(organizationId),
  });
}

export function useDeal(organizationId: string, dealId: string) {
  return useQuery({
    queryKey: ['organizations', organizationId, 'deals', dealId],
    queryFn: () => apiFetch<Deal>(`/organizations/${organizationId}/deals/${dealId}`),
    enabled: Boolean(organizationId) && Boolean(dealId),
  });
}

// `GET .../customers/:customerId/deals` — rota de conveniência exposta por
// CustomersController (não DealsController), mesmo padrão de
// useCustomerTimeline em lib/customers/use-customers.ts.
export function useCustomerDeals(organizationId: string, customerId: string) {
  return useQuery({
    queryKey: ['organizations', organizationId, 'customers', customerId, 'deals'],
    queryFn: () => apiFetch<Deal[]>(`/organizations/${organizationId}/customers/${customerId}/deals`),
    enabled: Boolean(organizationId) && Boolean(customerId),
  });
}

export function useCreateDeal(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateDealInput) =>
      apiFetch<Deal>(`/organizations/${organizationId}/deals`, { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['organizations', organizationId, 'deals'] }),
  });
}

export function useUpdateDeal(organizationId: string, dealId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateDealInput) =>
      apiFetch<Deal>(`/organizations/${organizationId}/deals/${dealId}`, { method: 'PATCH', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['organizations', organizationId, 'deals'] }),
  });
}

// Invalida também o dashboard — mudar de estágio afeta pipeline em $/win
// rate (`getDealPipelineOverview`), mesmo racional de useConvertLead
// invalidando `customers` além de `leads`.
export function useMoveDealStage(organizationId: string, dealId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: MoveDealStageInput) =>
      apiFetch<Deal>(`/organizations/${organizationId}/deals/${dealId}/move-stage`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organizations', organizationId, 'deals'] });
      queryClient.invalidateQueries({ queryKey: ['organizations', organizationId, 'dashboard'] });
    },
  });
}

// Variante de useMoveDealStage pra uso no Kanban arrastável (page.tsx): um
// único hook por organização (não por deal), já que `onDragEnd` recebe o
// `dealId` dinamicamente a partir do `result.draggableId` — ao contrário de
// useMoveDealStage, que é instanciado por DealCard com o dealId fixo.
export function useMoveDealStageForDeal(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ dealId, input }: { dealId: string; input: MoveDealStageInput }) =>
      apiFetch<Deal>(`/organizations/${organizationId}/deals/${dealId}/move-stage`, { method: 'POST', body: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organizations', organizationId, 'deals'] });
      queryClient.invalidateQueries({ queryKey: ['organizations', organizationId, 'dashboard'] });
    },
  });
}

export function useGenerateDealProposal(organizationId: string, dealId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<Deal>(`/organizations/${organizationId}/deals/${dealId}/generate-proposal`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['organizations', organizationId, 'deals'] }),
  });
}

// `apiFetch` sempre faz `response.json()` — não serve pra baixar o PDF
// (`application/pdf`). Fetch dedicado com o mesmo access token, convertido
// em Blob pra disparar o download do navegador — mesmo padrão de
// `downloadMeetingIcs` em lib/meetings/use-meetings.ts.
export async function downloadDealProposalPdf(organizationId: string, dealId: string, filename: string): Promise<void> {
  const tokens = getStoredTokens();
  const response = await fetch(
    `${env.NEXT_PUBLIC_API_URL}/organizations/${organizationId}/deals/${dealId}/proposal.pdf`,
    { headers: tokens ? { Authorization: `Bearer ${tokens.accessToken}` } : {} },
  );
  if (!response.ok) {
    throw new ApiError('Não foi possível baixar o PDF da proposta', response.status);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function useSignatureRequests(organizationId: string, dealId: string) {
  return useQuery({
    queryKey: ['organizations', organizationId, 'deals', dealId, 'signature-requests'],
    queryFn: () =>
      apiFetch<DealSignatureRequest[]>(`/organizations/${organizationId}/deals/${dealId}/signature-requests`),
    enabled: Boolean(organizationId) && Boolean(dealId),
  });
}

export function useRequestSignature(organizationId: string, dealId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<DealSignatureRequest>(`/organizations/${organizationId}/deals/${dealId}/request-signature`, {
        method: 'POST',
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['organizations', organizationId, 'deals', dealId, 'signature-requests'],
      }),
  });
}

export function useDeleteDeal(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dealId: string) =>
      apiFetch<void>(`/organizations/${organizationId}/deals/${dealId}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['organizations', organizationId, 'deals'] }),
  });
}
