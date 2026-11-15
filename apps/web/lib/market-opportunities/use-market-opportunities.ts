'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import type {
  ListMarketOpportunitiesFilter,
  MarketOpportunity,
  MarketOpportunityStatus,
} from './types';

function queryString(filter: ListMarketOpportunitiesFilter): string {
  if (!filter.status) return '';
  return `?status=${filter.status}`;
}

// Sem `useCreateMarketOpportunity`/`useRemoveMarketOpportunity` — de
// propósito: `MarketOpportunity` só nasce/atualiza mentionCount/sourceUrls/
// sampleQuotes pelo RedditClusteringConsumer no backend (não há POST/DELETE
// no controller, ver market-opportunities.controller.ts).
export function useMarketOpportunities(organizationId: string, filter: ListMarketOpportunitiesFilter = {}) {
  return useQuery({
    queryKey: ['organizations', organizationId, 'market-opportunities', filter],
    queryFn: () =>
      apiFetch<MarketOpportunity[]>(`/organizations/${organizationId}/market-opportunities${queryString(filter)}`),
    enabled: Boolean(organizationId),
  });
}

export function useMarketOpportunity(organizationId: string, opportunityId: string) {
  return useQuery({
    queryKey: ['organizations', organizationId, 'market-opportunities', opportunityId],
    queryFn: () =>
      apiFetch<MarketOpportunity>(`/organizations/${organizationId}/market-opportunities/${opportunityId}`),
    enabled: Boolean(organizationId) && Boolean(opportunityId),
  });
}

export function useUpdateMarketOpportunityStatus(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ opportunityId, status }: { opportunityId: string; status: MarketOpportunityStatus }) =>
      apiFetch<MarketOpportunity>(`/organizations/${organizationId}/market-opportunities/${opportunityId}/status`, {
        method: 'PATCH',
        body: { status },
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['organizations', organizationId, 'market-opportunities'] }),
  });
}
