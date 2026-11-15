'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import type {
  Automation,
  AutomationRun,
  CreateAutomationInput,
  RunAutomationNowResult,
  UpdateAutomationInput,
} from './types';

export function useAutomations(organizationId: string) {
  return useQuery({
    queryKey: ['organizations', organizationId, 'automations'],
    queryFn: () => apiFetch<Automation[]>(`/organizations/${organizationId}/automations`),
    enabled: Boolean(organizationId),
  });
}

export function useCreateAutomation(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAutomationInput) =>
      apiFetch<Automation>(`/organizations/${organizationId}/automations`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['organizations', organizationId, 'automations'] }),
  });
}

export function useUpdateAutomation(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ automationId, input }: { automationId: string; input: UpdateAutomationInput }) =>
      apiFetch<Automation>(`/organizations/${organizationId}/automations/${automationId}`, {
        method: 'PATCH',
        body: input,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['organizations', organizationId, 'automations'] }),
  });
}

export function useAutomationRuns(organizationId: string, automationId: string) {
  return useQuery({
    queryKey: ['organizations', organizationId, 'automations', automationId, 'runs'],
    queryFn: () =>
      apiFetch<AutomationRun[]>(`/organizations/${organizationId}/automations/${automationId}/runs`),
    enabled: Boolean(organizationId) && Boolean(automationId),
  });
}

// Dispara uma execução manual/teste — não invalida a lista nem o histórico
// de runs: a execução é assíncrona (enfileirada no worker), mesmo padrão de
// useRunProspectingTargetNow.
export function useRunAutomationNow(organizationId: string) {
  return useMutation({
    mutationFn: (automationId: string) =>
      apiFetch<RunAutomationNowResult>(`/organizations/${organizationId}/automations/${automationId}/run`, {
        method: 'POST',
      }),
  });
}
