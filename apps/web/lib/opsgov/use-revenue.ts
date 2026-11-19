'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import { opsgovRoot } from './use-company';
import type { Rbt12, RevenueBasis, RevenueByActivity, UnclassifiedEntry } from './types';

const base = (organizationId: string) => `/organizations/${organizationId}/opsgov/revenue`;

export function useUnclassifiedRevenue(organizationId: string, enabled = true) {
  return useQuery({
    queryKey: [...opsgovRoot(organizationId), 'revenue', 'unclassified'],
    queryFn: () => apiFetch<UnclassifiedEntry[]>(`${base(organizationId)}/unclassified`),
    enabled: Boolean(organizationId) && enabled,
  });
}

export function useRevenueByActivity(
  organizationId: string,
  range: { from: string; to: string; basis: RevenueBasis },
  enabled = true,
) {
  return useQuery({
    queryKey: [...opsgovRoot(organizationId), 'revenue', 'by-activity', range],
    queryFn: () =>
      apiFetch<RevenueByActivity>(
        `${base(organizationId)}/by-activity?from=${range.from}&to=${range.to}&basis=${range.basis}`,
      ),
    enabled: Boolean(organizationId) && enabled,
  });
}

export function useRbt12(organizationId: string, month: string, basis: RevenueBasis, enabled = true) {
  return useQuery({
    queryKey: [...opsgovRoot(organizationId), 'revenue', 'rbt12', month, basis],
    queryFn: () => apiFetch<Rbt12>(`${base(organizationId)}/rbt12?month=${month}&basis=${basis}`),
    enabled: Boolean(organizationId) && enabled,
  });
}

export function useClassifyRevenue(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { entryIds: string[]; companyActivityId: string | null }) =>
      apiFetch<{ classified: number }>(`${base(organizationId)}/classify`, { method: 'PATCH', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [...opsgovRoot(organizationId), 'revenue'] }),
  });
}
