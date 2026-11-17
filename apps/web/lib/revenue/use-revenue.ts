'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import type {
  RevenueCopyPerformance,
  RevenueCosts,
  RevenueOverview,
  RevenuePeriod,
  RevenuePipeline,
  RevenueSettings,
  RevenueSettingsPatch,
} from './types';

const key = (organizationId: string, ...rest: unknown[]) => ['organizations', organizationId, 'revenue', ...rest];

export function useRevenueOverview(organizationId: string, period: RevenuePeriod) {
  return useQuery({
    queryKey: key(organizationId, 'overview', period),
    queryFn: () => apiFetch<RevenueOverview>(`/organizations/${organizationId}/revenue/overview?period=${period}`),
    enabled: Boolean(organizationId),
  });
}

export function useRevenuePipeline(organizationId: string) {
  return useQuery({
    queryKey: key(organizationId, 'pipeline'),
    queryFn: () => apiFetch<RevenuePipeline>(`/organizations/${organizationId}/revenue/pipeline`),
    enabled: Boolean(organizationId),
  });
}

export function useRevenueCosts(organizationId: string, period: RevenuePeriod) {
  return useQuery({
    queryKey: key(organizationId, 'costs', period),
    queryFn: () => apiFetch<RevenueCosts>(`/organizations/${organizationId}/revenue/costs?period=${period}`),
    enabled: Boolean(organizationId),
  });
}

export function useRevenueCopyPerformance(organizationId: string) {
  return useQuery({
    queryKey: key(organizationId, 'copy-performance'),
    queryFn: () => apiFetch<RevenueCopyPerformance>(`/organizations/${organizationId}/revenue/copy-performance`),
    enabled: Boolean(organizationId),
  });
}

export function useRevenueSettings(organizationId: string) {
  return useQuery({
    queryKey: key(organizationId, 'settings'),
    queryFn: () => apiFetch<RevenueSettings>(`/organizations/${organizationId}/revenue/settings`),
    enabled: Boolean(organizationId),
  });
}

export function useUpdateRevenueSettings(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: RevenueSettingsPatch) =>
      apiFetch<RevenueSettings>(`/organizations/${organizationId}/revenue/settings`, {
        method: 'PATCH',
        body: patch,
      }),
    onSuccess: (settings) => {
      queryClient.setQueryData(key(organizationId, 'settings'), settings);
    },
  });
}
