'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import { opsgovRoot } from './use-company';
import type {
  ConvertInput,
  OpportunityDetail,
  OpportunityInput,
  OpportunityPatch,
  OpportunitySummary,
  ProcurementOverview,
  ProcurementStatus,
  Requirement,
  RequirementInput,
  RequirementPatch,
  TechnicalCertificate,
  TechnicalCertificateInput,
} from './types';

const base = (organizationId: string) => `/organizations/${organizationId}/opsgov`;

// Prontidão depende de certidões, CNAEs e atestados: qualquer escrita aqui
// invalida o OpsGov inteiro, para o painel e o checklist não ficarem velhos.
function useOpsGovMutation<TInput, TResult>(organizationId: string, request: (input: TInput) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: opsgovRoot(organizationId) }),
  });
}

export function useProcurementOverview(organizationId: string) {
  return useQuery({
    queryKey: [...opsgovRoot(organizationId), 'readiness'],
    queryFn: () => apiFetch<ProcurementOverview>(`${base(organizationId)}/readiness`),
    enabled: Boolean(organizationId),
  });
}

export function useOpportunities(organizationId: string) {
  return useQuery({
    queryKey: [...opsgovRoot(organizationId), 'procurement'],
    queryFn: () => apiFetch<OpportunitySummary[]>(`${base(organizationId)}/procurement`),
    enabled: Boolean(organizationId),
  });
}

export function useOpportunity(organizationId: string, opportunityId: string) {
  return useQuery({
    queryKey: [...opsgovRoot(organizationId), 'procurement', opportunityId],
    queryFn: () => apiFetch<OpportunityDetail>(`${base(organizationId)}/procurement/${opportunityId}`),
    enabled: Boolean(organizationId && opportunityId),
  });
}

export function useCreateOpportunity(organizationId: string) {
  return useOpsGovMutation(organizationId, (input: OpportunityInput) =>
    apiFetch<OpportunityDetail>(`${base(organizationId)}/procurement`, { method: 'POST', body: input }),
  );
}

export function useUpdateOpportunity(organizationId: string, opportunityId: string) {
  return useOpsGovMutation(organizationId, (patch: OpportunityPatch) =>
    apiFetch<OpportunityDetail>(`${base(organizationId)}/procurement/${opportunityId}`, { method: 'PATCH', body: patch }),
  );
}

export function useChangeOpportunityStatus(organizationId: string, opportunityId: string) {
  return useOpsGovMutation(organizationId, (body: { status: ProcurementStatus; reason?: string }) =>
    apiFetch<OpportunityDetail>(`${base(organizationId)}/procurement/${opportunityId}/status`, { method: 'POST', body }),
  );
}

export function useConvertOpportunity(organizationId: string, opportunityId: string) {
  return useOpsGovMutation(organizationId, (body: ConvertInput) =>
    apiFetch<OpportunityDetail>(`${base(organizationId)}/procurement/${opportunityId}/convert`, { method: 'POST', body }),
  );
}

export function useAddRequirement(organizationId: string, opportunityId: string) {
  return useOpsGovMutation(organizationId, (input: RequirementInput) =>
    apiFetch<Requirement>(`${base(organizationId)}/procurement/${opportunityId}/requirements`, { method: 'POST', body: input }),
  );
}

export function useUpdateRequirement(organizationId: string, opportunityId: string) {
  return useOpsGovMutation(organizationId, ({ id, ...body }: RequirementPatch & { id: string }) =>
    apiFetch<Requirement>(`${base(organizationId)}/procurement/${opportunityId}/requirements/${id}`, {
      method: 'PATCH',
      body,
    }),
  );
}

export function useRemoveRequirement(organizationId: string, opportunityId: string) {
  return useOpsGovMutation(organizationId, (id: string) =>
    apiFetch<void>(`${base(organizationId)}/procurement/${opportunityId}/requirements/${id}`, { method: 'DELETE' }),
  );
}

export function useTechnicalCertificates(organizationId: string) {
  return useQuery({
    queryKey: [...opsgovRoot(organizationId), 'technical-certificates'],
    queryFn: () => apiFetch<TechnicalCertificate[]>(`${base(organizationId)}/technical-certificates`),
    enabled: Boolean(organizationId),
  });
}

export function useCreateTechnicalCertificate(organizationId: string) {
  return useOpsGovMutation(organizationId, (input: TechnicalCertificateInput) =>
    apiFetch<TechnicalCertificate>(`${base(organizationId)}/technical-certificates`, { method: 'POST', body: input }),
  );
}

export function useUpdateTechnicalCertificate(organizationId: string) {
  return useOpsGovMutation(
    organizationId,
    ({ id, ...body }: { id: string; companyActivityId?: string | null; documentId?: string; notes?: string }) =>
      apiFetch<TechnicalCertificate>(`${base(organizationId)}/technical-certificates/${id}`, { method: 'PATCH', body }),
  );
}
