'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import type { Lead, LeadEnrichment } from './types';

// `POST .../leads/:leadId/enrich` — busca firmographics via Explorium e
// recalcula o score em seguida (ver `LeadsService.enrich`); devolve o Lead
// atualizado (não um LeadEnrichment isolado), por isso mora ao lado dos
// hooks de mutação do próprio Lead, não em use-outreach-messages.ts.
export function useEnrichLead(organizationId: string, leadId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<Lead>(`/organizations/${organizationId}/leads/${leadId}/enrich`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['organizations', organizationId, 'leads'] }),
  });
}

// `POST .../leads/:leadId/analyze` — análise de IA opt-in (nunca automática
// em massa, ver comentário de topo de lead-analysis.service.ts). Devolve o
// `LeadEnrichment{type:'ai_analysis'}` recém-criado — a UI mostra
// `data.text` direto do resultado da mutation, e invalida a leitura do Lead
// para que o histórico de enrichments (incluído em `GET .../leads/:leadId`)
// reflita a nova entrada em visitas futuras.
export function useAnalyzeLeadPotential(organizationId: string, leadId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<LeadEnrichment>(`/organizations/${organizationId}/leads/${leadId}/analyze`, { method: 'POST' }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['organizations', organizationId, 'leads', leadId] }),
  });
}
