'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import type {
  AddActivityInput,
  ChangeActivityInput,
  ChangeRegimeInput,
  ChangeRegistrationInput,
  CompanyActivity,
  CompanyOverview,
  CompanyProfile,
  RegistrationPeriod,
  TaxRegimePeriod,
  UpsertProfileInput,
} from './types';

const base = (organizationId: string) => `/organizations/${organizationId}/opsgov/company`;
export const opsgovRoot = (organizationId: string) => ['organizations', organizationId, 'opsgov'] as const;

export function useCompanyOverview(organizationId: string) {
  return useQuery({
    queryKey: [...opsgovRoot(organizationId), 'company'],
    queryFn: () => apiFetch<CompanyOverview>(base(organizationId)),
    enabled: Boolean(organizationId),
  });
}

// Cadastro/regime alimentam simulador, prontidão e relatórios: invalida o OpsGov inteiro.
function useOpsGovMutation<TInput, TResult>(organizationId: string, request: (input: TInput) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: opsgovRoot(organizationId) }),
  });
}

export function useUpsertCompanyProfile(organizationId: string) {
  return useOpsGovMutation(organizationId, (input: UpsertProfileInput) =>
    apiFetch<CompanyProfile>(`${base(organizationId)}/profile`, { method: 'PUT', body: input }),
  );
}

export function useChangeRegistration(organizationId: string) {
  return useOpsGovMutation(organizationId, (input: ChangeRegistrationInput) =>
    apiFetch<RegistrationPeriod>(`${base(organizationId)}/registrations`, { method: 'POST', body: input }),
  );
}

export function useChangeRegime(organizationId: string) {
  return useOpsGovMutation(organizationId, (input: ChangeRegimeInput) =>
    apiFetch<TaxRegimePeriod>(`${base(organizationId)}/regimes`, { method: 'POST', body: input }),
  );
}

export function useAddActivity(organizationId: string) {
  return useOpsGovMutation(organizationId, (input: AddActivityInput) =>
    apiFetch<CompanyActivity>(`${base(organizationId)}/activities`, { method: 'POST', body: input }),
  );
}

export function useChangeActivity(organizationId: string) {
  return useOpsGovMutation(organizationId, ({ activityId, ...input }: ChangeActivityInput & { activityId: string }) =>
    apiFetch<CompanyActivity>(`${base(organizationId)}/activities/${activityId}/versions`, { method: 'POST', body: input }),
  );
}

export function useEndActivity(organizationId: string) {
  return useOpsGovMutation(organizationId, ({ activityId, validTo }: { activityId: string; validTo: string }) =>
    apiFetch<CompanyActivity>(`${base(organizationId)}/activities/${activityId}/end`, { method: 'PATCH', body: { validTo } }),
  );
}
