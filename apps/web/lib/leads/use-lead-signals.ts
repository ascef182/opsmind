'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import type { LeadSignal } from './types';

// `GET .../leads/:leadId/signals` — leitura, qualquer papel (ver
// LeadsController.listSignals). Fica num hook próprio (não dentro de
// use-leads.ts) pelo mesmo motivo de use-lead-enrichment.ts: é uma leitura
// auxiliar de uma sub-rota do Lead, não o Lead em si.
export function useLeadSignals(organizationId: string, leadId: string) {
  return useQuery({
    queryKey: ['organizations', organizationId, 'leads', leadId, 'signals'],
    queryFn: () => apiFetch<LeadSignal[]>(`/organizations/${organizationId}/leads/${leadId}/signals`),
  });
}

// `POST .../leads/:leadId/investigate` — enfileira o profiler de site
// (Fase 1, sem IA ainda — ver website-profiler-processor.ts). Invalida
// tanto os sinais quanto o Lead (o score é recalculado pelo worker ao
// terminar) para que uma nova busca manual eventualmente reflita o
// resultado; não há um jeito direto de "esperar o job terminar" aqui, então
// a UI deve tratar isso como fire-and-forget (mesmo padrão de find_leads).
export function useInvestigateLeadWebsite(organizationId: string, leadId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<void>(`/organizations/${organizationId}/leads/${leadId}/investigate`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organizations', organizationId, 'leads', leadId, 'signals'] });
      queryClient.invalidateQueries({ queryKey: ['organizations', organizationId, 'leads', leadId] });
    },
  });
}
