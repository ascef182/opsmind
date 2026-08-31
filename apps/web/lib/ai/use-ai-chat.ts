'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api-client';

export interface ChatResult {
  reply: string;
  aiRequestId: string;
}

export interface DailyUsagePoint {
  date: string;
  cost: number;
  requests: number;
}

export interface UserUsageBreakdown {
  userId: string;
  name: string;
  cost: number;
  requests: number;
  inputTokens: number;
  outputTokens: number;
}

export interface UsageResult {
  monthSpend: number;
  monthlyBudget: number | null;
  dailySeries: DailyUsagePoint[];
  byUser: UserUsageBreakdown[];
  avgLatencyMs: number;
  totalRequests: number;
}

export interface RecentAiRequestToolCall {
  toolName: string;
  isError: boolean;
  input: unknown;
  output: unknown;
}

export interface RecentAiRequest {
  id: string;
  userId: string;
  userName: string;
  model: string;
  status: 'SUCCESS' | 'ERROR' | 'BUDGET_EXCEEDED';
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  estimatedCost: number;
  createdAt: string;
  toolCalls: RecentAiRequestToolCall[];
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

export function useAiRequests(organizationId: string) {
  return useQuery({
    queryKey: ['organizations', organizationId, 'ai', 'requests'],
    queryFn: () => apiFetch<RecentAiRequest[]>(`/organizations/${organizationId}/ai/requests`),
    enabled: Boolean(organizationId),
  });
}
