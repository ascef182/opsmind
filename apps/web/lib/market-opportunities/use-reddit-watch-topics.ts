'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import type {
  CreateRedditWatchTopicInput,
  ListRedditWatchTopicsFilter,
  RedditWatchTopic,
  UpdateRedditWatchTopicInput,
} from './types';

function queryString(filter: ListRedditWatchTopicsFilter): string {
  if (filter.isActive === undefined) return '';
  return `?isActive=${filter.isActive}`;
}

export function useRedditWatchTopics(organizationId: string, filter: ListRedditWatchTopicsFilter = {}) {
  return useQuery({
    queryKey: ['organizations', organizationId, 'reddit-watch-topics', filter],
    queryFn: () =>
      apiFetch<RedditWatchTopic[]>(`/organizations/${organizationId}/reddit-watch-topics${queryString(filter)}`),
    enabled: Boolean(organizationId),
  });
}

export function useCreateRedditWatchTopic(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateRedditWatchTopicInput) =>
      apiFetch<RedditWatchTopic>(`/organizations/${organizationId}/reddit-watch-topics`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['organizations', organizationId, 'reddit-watch-topics'] }),
  });
}

// Usado tanto pra editar query/subreddit quanto pra ativar/desativar
// (`{ isActive }`) — mesmo endpoint PATCH cobre os dois casos, espelhando
// UpdateRedditWatchTopicDto no backend.
export function useUpdateRedditWatchTopic(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ topicId, input }: { topicId: string; input: UpdateRedditWatchTopicInput }) =>
      apiFetch<RedditWatchTopic>(`/organizations/${organizationId}/reddit-watch-topics/${topicId}`, {
        method: 'PATCH',
        body: input,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['organizations', organizationId, 'reddit-watch-topics'] }),
  });
}

// Dispara um scan manual "agora" (ignora isActive) — endpoint
// `POST .../reddit-watch-topics/:id/scan-now`, `RedditWatchTopicsService.runNow`.
// Invalida a query de tópicos: o resultado (lastScannedAt/lastScanStatus)
// só aparece depois que o worker processar, mas o botão precisa refletir o
// estado mais recente quando o usuário voltar a olhar a lista.
export function useRunRedditWatchTopicNow(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (topicId: string) =>
      apiFetch<unknown>(`/organizations/${organizationId}/reddit-watch-topics/${topicId}/scan-now`, {
        method: 'POST',
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['organizations', organizationId, 'reddit-watch-topics'] }),
  });
}

export function useRemoveRedditWatchTopic(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (topicId: string) =>
      apiFetch<void>(`/organizations/${organizationId}/reddit-watch-topics/${topicId}`, { method: 'DELETE' }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['organizations', organizationId, 'reddit-watch-topics'] }),
  });
}
