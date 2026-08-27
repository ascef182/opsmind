'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api-client';

export interface ChatResult {
  reply: string;
  aiRequestId: string;
}

export interface UsageResult {
  monthSpend: number;
}

export function useAiChat(organizationId: string) {
  return useMutation({
    mutationFn: (message: string) =>
      apiFetch<ChatResult>(`/organizations/${organizationId}/ai/chat`, {
        method: 'POST',
        body: { message },
      }),
  });
}

export function useAiUsage(organizationId: string) {
  return useQuery({
    queryKey: ['organizations', organizationId, 'ai', 'usage'],
    queryFn: () => apiFetch<UsageResult>(`/organizations/${organizationId}/ai/usage`),
    enabled: Boolean(organizationId),
  });
}
