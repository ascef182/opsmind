'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import type { Notification } from './types';

export function useNotifications(organizationId: string) {
  return useQuery({
    queryKey: ['organizations', organizationId, 'notifications'],
    queryFn: () => apiFetch<Notification[]>(`/organizations/${organizationId}/notifications`),
    enabled: Boolean(organizationId),
    // Sem WebSocket/SSE ainda — poll simples pra novas notificações (ex.: o
    // lembrete de follow-up do worker) aparecerem sem precisar recarregar a
    // página.
    refetchInterval: 60_000,
  });
}

export function useMarkNotificationRead(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (notificationId: string) =>
      apiFetch<Notification>(`/organizations/${organizationId}/notifications/${notificationId}/read`, {
        method: 'PATCH',
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['organizations', organizationId, 'notifications'] }),
  });
}
