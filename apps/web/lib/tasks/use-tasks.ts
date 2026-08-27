'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import type { CreateTaskInput, ListTasksFilter, Task, UpdateTaskInput } from './types';

function queryString(filter: ListTasksFilter): string {
  const params = new URLSearchParams();
  if (filter.status) params.set('status', filter.status);
  if (filter.customerId) params.set('customerId', filter.customerId);
  const query = params.toString();
  return query ? `?${query}` : '';
}

export function useTasks(organizationId: string, filter: ListTasksFilter = {}) {
  return useQuery({
    queryKey: ['organizations', organizationId, 'tasks', filter],
    queryFn: () => apiFetch<Task[]>(`/organizations/${organizationId}/tasks${queryString(filter)}`),
    enabled: Boolean(organizationId),
  });
}

export function useCreateTask(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTaskInput) =>
      apiFetch<Task>(`/organizations/${organizationId}/tasks`, { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['organizations', organizationId, 'tasks'] }),
  });
}

export function useUpdateTask(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, input }: { taskId: string; input: UpdateTaskInput }) =>
      apiFetch<Task>(`/organizations/${organizationId}/tasks/${taskId}`, { method: 'PATCH', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['organizations', organizationId, 'tasks'] }),
  });
}
