'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import type {
  ActivityLogEntry,
  Customer,
  CreateCustomerInput,
  ListCustomersFilter,
  UpdateCustomerInput,
} from './types';

function queryString(filter: ListCustomersFilter): string {
  const params = new URLSearchParams();
  if (filter.status) params.set('status', filter.status);
  if (filter.search) params.set('search', filter.search);
  const query = params.toString();
  return query ? `?${query}` : '';
}

export function useCustomers(organizationId: string, filter: ListCustomersFilter = {}) {
  return useQuery({
    queryKey: ['organizations', organizationId, 'customers', filter],
    queryFn: () => apiFetch<Customer[]>(`/organizations/${organizationId}/customers${queryString(filter)}`),
    enabled: Boolean(organizationId),
  });
}

export function useCustomer(organizationId: string, customerId: string) {
  return useQuery({
    queryKey: ['organizations', organizationId, 'customers', customerId],
    queryFn: () => apiFetch<Customer>(`/organizations/${organizationId}/customers/${customerId}`),
    enabled: Boolean(organizationId) && Boolean(customerId),
  });
}

export function useCustomerTimeline(organizationId: string, customerId: string) {
  return useQuery({
    queryKey: ['organizations', organizationId, 'customers', customerId, 'timeline'],
    queryFn: () =>
      apiFetch<ActivityLogEntry[]>(`/organizations/${organizationId}/customers/${customerId}/timeline`),
    enabled: Boolean(organizationId) && Boolean(customerId),
  });
}

export function useCreateCustomer(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCustomerInput) =>
      apiFetch<Customer>(`/organizations/${organizationId}/customers`, { method: 'POST', body: input }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['organizations', organizationId, 'customers'] }),
  });
}

export function useUpdateCustomer(organizationId: string, customerId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateCustomerInput) =>
      apiFetch<Customer>(`/organizations/${organizationId}/customers/${customerId}`, {
        method: 'PATCH',
        body: input,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organizations', organizationId, 'customers'] });
    },
  });
}

export function useAddNote(organizationId: string, customerId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (note: string) =>
      apiFetch<ActivityLogEntry>(`/organizations/${organizationId}/customers/${customerId}/notes`, {
        method: 'POST',
        body: { note },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['organizations', organizationId, 'customers', customerId, 'timeline'],
      });
      queryClient.invalidateQueries({
        queryKey: ['organizations', organizationId, 'customers', customerId],
      });
    },
  });
}
