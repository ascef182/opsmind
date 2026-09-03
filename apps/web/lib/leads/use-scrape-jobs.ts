'use client';

import { useMutation, useQuery, useQueryClient, type Query } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import type { CreateScrapeJobInput, ListScrapeJobsFilter, ScrapeJob } from './types';

const ACTIVE_STATUSES = new Set(['QUEUED', 'RUNNING']);

// Enquanto o worker (Task 6) ainda pode mudar o status de um job a qualquer
// momento, os cards de progresso devem se atualizar sozinhos — poll a cada
// 3s até todo job relevante chegar num status terminal (COMPLETED/FAILED/
// CANCELLED). Mesmo intervalo/racional de
// ../feat-prospecting-outbound/apps/web/lib/prospecting/use-scrape-jobs.ts,
// adaptado para a LISTA inteira (não só um job): continua fazendo polling
// enquanto QUALQUER job da página estiver ativo, não só o primeiro.
function pollWhileAnyActive(query: Query<ScrapeJob[]>): number | false {
  const jobs = query.state.data ?? [];
  return jobs.some((job) => ACTIVE_STATUSES.has(job.status)) ? 3000 : false;
}

function pollWhileActive(query: Query<ScrapeJob>): number | false {
  const status = query.state.data?.status;
  return status !== undefined && ACTIVE_STATUSES.has(status) ? 3000 : false;
}

function queryString(filter: ListScrapeJobsFilter): string {
  const params = new URLSearchParams();
  if (filter.status) params.set('status', filter.status);
  const query = params.toString();
  return query ? `?${query}` : '';
}

export function useScrapeJobs(organizationId: string, filter: ListScrapeJobsFilter = {}) {
  return useQuery({
    queryKey: ['organizations', organizationId, 'scrape-jobs', filter],
    queryFn: () => apiFetch<ScrapeJob[]>(`/organizations/${organizationId}/scrape-jobs${queryString(filter)}`),
    enabled: Boolean(organizationId),
    refetchInterval: pollWhileAnyActive,
  });
}

export function useScrapeJob(organizationId: string, scrapeJobId: string) {
  return useQuery({
    queryKey: ['organizations', organizationId, 'scrape-jobs', scrapeJobId],
    queryFn: () => apiFetch<ScrapeJob>(`/organizations/${organizationId}/scrape-jobs/${scrapeJobId}`),
    enabled: Boolean(organizationId) && Boolean(scrapeJobId),
    refetchInterval: pollWhileActive,
  });
}

export function useCreateScrapeJob(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateScrapeJobInput) =>
      apiFetch<ScrapeJob>(`/organizations/${organizationId}/scrape-jobs`, { method: 'POST', body: input }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['organizations', organizationId, 'scrape-jobs'] }),
  });
}
