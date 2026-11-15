'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import { getStoredTokens } from '../auth/token-storage';
import { env } from '../env';
import type {
  AnnualReport,
  Contract,
  CreateContractInput,
  CreateEntryInput,
  CreateRecurringInput,
  EntryFilter,
  FinanceOverview,
  FinancialEntry,
  ProfitabilityReport,
  RecurringEntry,
  RegisterPaymentInput,
  UpdateEntryInput,
  UpdateRecurringInput,
} from './types';

const base = (organizationId: string) => `/organizations/${organizationId}/finance`;
const root = (organizationId: string) => ['organizations', organizationId, 'finance'] as const;

function qs(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

// `enabled` fecha a consulta para papéis sem acesso: um 403 previsível não
// precisa ser disparado só para a API recusar.
export function useFinanceOverview(organizationId: string, month: string | undefined, enabled = true) {
  return useQuery({
    queryKey: [...root(organizationId), 'overview', month ?? 'current'],
    queryFn: () => apiFetch<FinanceOverview>(`${base(organizationId)}/overview${qs({ month })}`),
    enabled: Boolean(organizationId) && enabled,
  });
}

export function useAnnualReport(organizationId: string, year: number, enabled = true) {
  return useQuery({
    queryKey: [...root(organizationId), 'annual', year],
    queryFn: () => apiFetch<AnnualReport>(`${base(organizationId)}/reports/annual${qs({ year })}`),
    enabled: Boolean(organizationId) && enabled,
  });
}

export function useProfitability(
  organizationId: string,
  by: 'customer' | 'contract',
  range: { from?: string; to?: string },
  enabled = true,
) {
  return useQuery({
    queryKey: [...root(organizationId), 'profitability', by, range],
    queryFn: () =>
      apiFetch<ProfitabilityReport>(`${base(organizationId)}/reports/profitability${qs({ by, ...range })}`),
    enabled: Boolean(organizationId) && enabled,
  });
}

export function useFinancialEntries(organizationId: string, filter: EntryFilter, enabled = true) {
  return useQuery({
    queryKey: [...root(organizationId), 'entries', filter],
    queryFn: () => apiFetch<FinancialEntry[]>(`${base(organizationId)}/entries${qs({ ...filter })}`),
    enabled: Boolean(organizationId) && enabled,
  });
}

export function useFinancialEntry(organizationId: string, entryId: string | null) {
  return useQuery({
    queryKey: [...root(organizationId), 'entry', entryId],
    queryFn: () => apiFetch<FinancialEntry>(`${base(organizationId)}/entries/${entryId}`),
    enabled: Boolean(organizationId) && Boolean(entryId),
  });
}

/** Qualquer mudança financeira pode alterar overview, relatórios, contratos e lançamentos. */
function useInvalidateFinance(organizationId: string) {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: root(organizationId) });
}

export function useCreateEntry(organizationId: string) {
  const invalidate = useInvalidateFinance(organizationId);
  return useMutation({
    mutationFn: (input: CreateEntryInput) =>
      apiFetch<FinancialEntry>(`${base(organizationId)}/entries`, { method: 'POST', body: input }),
    onSuccess: invalidate,
  });
}

export function useRegisterPayment(organizationId: string, entryId: string) {
  const invalidate = useInvalidateFinance(organizationId);
  return useMutation({
    mutationFn: (input: RegisterPaymentInput) =>
      apiFetch<FinancialEntry>(`${base(organizationId)}/entries/${entryId}/payments`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: invalidate,
  });
}

export function useReversePayment(organizationId: string, entryId: string) {
  const invalidate = useInvalidateFinance(organizationId);
  return useMutation({
    mutationFn: ({ paymentId, reason }: { paymentId: string; reason: string }) =>
      apiFetch<FinancialEntry>(`${base(organizationId)}/entries/${entryId}/payments/${paymentId}/reverse`, {
        method: 'POST',
        body: { reason },
      }),
    onSuccess: invalidate,
  });
}

export function useCancelEntry(organizationId: string, entryId: string) {
  const invalidate = useInvalidateFinance(organizationId);
  return useMutation({
    mutationFn: (reason: string) =>
      apiFetch<FinancialEntry>(`${base(organizationId)}/entries/${entryId}/cancel`, {
        method: 'POST',
        body: { reason },
      }),
    onSuccess: invalidate,
  });
}

export function useUpdateEntry(organizationId: string, entryId: string) {
  const invalidate = useInvalidateFinance(organizationId);
  return useMutation({
    mutationFn: (input: UpdateEntryInput) =>
      apiFetch<FinancialEntry>(`${base(organizationId)}/entries/${entryId}`, { method: 'PATCH', body: input }),
    onSuccess: invalidate,
  });
}

export function useIssueEntry(organizationId: string, entryId: string) {
  const invalidate = useInvalidateFinance(organizationId);
  return useMutation({
    mutationFn: (dueDate?: string) =>
      apiFetch<FinancialEntry>(`${base(organizationId)}/entries/${entryId}/issue`, {
        method: 'POST',
        body: { dueDate },
      }),
    onSuccess: invalidate,
  });
}

export function useContracts(organizationId: string, status?: string, enabled = true) {
  return useQuery({
    queryKey: [...root(organizationId), 'contracts', status ?? 'all'],
    queryFn: () => apiFetch<Contract[]>(`${base(organizationId)}/contracts${qs({ status })}`),
    enabled: Boolean(organizationId) && enabled,
  });
}

export function useCreateContract(organizationId: string) {
  const invalidate = useInvalidateFinance(organizationId);
  return useMutation({
    mutationFn: (input: CreateContractInput) =>
      apiFetch<Contract>(`${base(organizationId)}/contracts`, { method: 'POST', body: input }),
    onSuccess: invalidate,
  });
}

export function useUpdateContractStatus(organizationId: string, contractId: string) {
  const invalidate = useInvalidateFinance(organizationId);
  return useMutation({
    mutationFn: (status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED') =>
      apiFetch<Contract>(`${base(organizationId)}/contracts/${contractId}`, {
        method: 'PATCH',
        body: { status },
      }),
    onSuccess: invalidate,
  });
}

export function useCreateContractFromDeal(organizationId: string, dealId: string) {
  const invalidate = useInvalidateFinance(organizationId);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { billing?: 'ONE_TIME' | 'MONTHLY'; billingDay?: number; firstDueDate?: string }) =>
      apiFetch<{ contract: Contract; tasksCreated: number }>(`${base(organizationId)}/contracts/from-deal/${dealId}`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: ['organizations', organizationId, 'tasks'] });
    },
  });
}

export function useRecurringEntries(organizationId: string, enabled = true) {
  return useQuery({
    queryKey: [...root(organizationId), 'recurring'],
    queryFn: () => apiFetch<RecurringEntry[]>(`${base(organizationId)}/recurring`),
    enabled: Boolean(organizationId) && enabled,
  });
}

export function useCreateRecurring(organizationId: string) {
  const invalidate = useInvalidateFinance(organizationId);
  return useMutation({
    mutationFn: (input: CreateRecurringInput) =>
      apiFetch<RecurringEntry>(`${base(organizationId)}/recurring`, { method: 'POST', body: input }),
    onSuccess: invalidate,
  });
}

export function useToggleRecurring(organizationId: string, recurringId: string) {
  const invalidate = useInvalidateFinance(organizationId);
  return useMutation({
    mutationFn: (active: boolean) =>
      apiFetch<RecurringEntry>(`${base(organizationId)}/recurring/${recurringId}`, {
        method: 'PATCH',
        body: { active },
      }),
    onSuccess: invalidate,
  });
}

export function useUpdateRecurring(organizationId: string, recurringId: string) {
  const invalidate = useInvalidateFinance(organizationId);
  return useMutation({
    mutationFn: (input: UpdateRecurringInput) =>
      apiFetch<RecurringEntry>(`${base(organizationId)}/recurring/${recurringId}`, { method: 'PATCH', body: input }),
    onSuccess: invalidate,
  });
}

export function useGenerateRecurring(organizationId: string) {
  const invalidate = useInvalidateFinance(organizationId);
  return useMutation({
    mutationFn: () =>
      apiFetch<{ created: number; templates: number; upToMonth: string }>(`${base(organizationId)}/recurring/generate`, {
        method: 'POST',
        body: {},
      }),
    onSuccess: invalidate,
  });
}

/**
 * O CSV exige o header Authorization, então não dá para ser um <a href>:
 * baixa via fetch e entrega um Blob. (Sem refresh automático de token — se o
 * acesso expirou, o usuário vê o erro e repete; as telas já renovam o token
 * em qualquer outra consulta.)
 */
export async function downloadEntriesCsv(organizationId: string, filter: EntryFilter): Promise<void> {
  const tokens = getStoredTokens();
  const response = await fetch(
    `${env.NEXT_PUBLIC_API_URL}${base(organizationId)}/entries/export.csv${qs({ ...filter })}`,
    { headers: tokens ? { Authorization: `Bearer ${tokens.accessToken}` } : {} },
  );
  if (!response.ok) throw new Error(`Não foi possível exportar (erro ${response.status})`);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = 'lancamentos.csv';
  link.click();
  URL.revokeObjectURL(url);
}
