'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from '../api-client';
import { getStoredTokens } from '../auth/token-storage';
import { env } from '../env';
import type { CreateMeetingInput, Meeting, UpdateMeetingInput } from './types';

// `apiFetch` sempre faz `response.json()` — não serve pra baixar o `.ics`
// (`text/calendar`). Fetch dedicado com o mesmo access token, convertido em
// Blob pra disparar o download do navegador (link `<a>` puro não funciona
// aqui: a rota exige Bearer token, não cookie).
export async function downloadMeetingIcs(organizationId: string, meetingId: string, filename: string): Promise<void> {
  const tokens = getStoredTokens();
  const response = await fetch(
    `${env.NEXT_PUBLIC_API_URL}/organizations/${organizationId}/meetings/${meetingId}/ics`,
    { headers: tokens ? { Authorization: `Bearer ${tokens.accessToken}` } : {} },
  );
  if (!response.ok) {
    throw new ApiError('Não foi possível baixar o arquivo .ics', response.status);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function useMeetings(organizationId: string, dealId: string) {
  return useQuery({
    queryKey: ['organizations', organizationId, 'deals', dealId, 'meetings'],
    queryFn: () => apiFetch<Meeting[]>(`/organizations/${organizationId}/deals/${dealId}/meetings`),
    enabled: Boolean(organizationId) && Boolean(dealId),
  });
}

export function useCreateMeeting(organizationId: string, dealId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateMeetingInput) =>
      apiFetch<Meeting>(`/organizations/${organizationId}/deals/${dealId}/meetings`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['organizations', organizationId, 'deals', dealId, 'meetings'] }),
  });
}

export function useUpdateMeeting(organizationId: string, dealId: string, meetingId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateMeetingInput) =>
      apiFetch<Meeting>(`/organizations/${organizationId}/meetings/${meetingId}`, {
        method: 'PATCH',
        body: input,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['organizations', organizationId, 'deals', dealId, 'meetings'] }),
  });
}

export function useCancelMeeting(organizationId: string, dealId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (meetingId: string) =>
      apiFetch<Meeting>(`/organizations/${organizationId}/meetings/${meetingId}/cancel`, { method: 'POST' }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['organizations', organizationId, 'deals', dealId, 'meetings'] }),
  });
}
