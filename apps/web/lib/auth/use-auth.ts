'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AuthTokens, LoginInput, RegisterInput } from '@opsmind/shared-types';
import { apiFetch } from '../api-client';
import { clearTokens, getStoredTokens, storeTokens } from './token-storage';

export interface CurrentUser {
  id: string;
  email: string;
}

export function useCurrentUser() {
  return useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => apiFetch<CurrentUser>('/auth/me'),
    enabled: getStoredTokens() !== null,
    retry: false,
  });
}

export function useRegister() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RegisterInput) => apiFetch<AuthTokens>('/auth/register', { method: 'POST', body: input, auth: false }),
    onSuccess: (tokens) => {
      storeTokens(tokens);
      return queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
    },
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginInput) => apiFetch<AuthTokens>('/auth/login', { method: 'POST', body: input, auth: false }),
    onSuccess: (tokens) => {
      storeTokens(tokens);
      return queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const tokens = getStoredTokens();
      if (tokens) {
        // Best-effort: se a API estiver fora do ar, ainda assim limpamos os
        // tokens locais abaixo — "logout" no cliente não deve depender da rede.
        await apiFetch('/auth/logout', { method: 'POST', body: { refreshToken: tokens.refreshToken } }).catch(() => undefined);
      }
    },
    onSettled: () => {
      clearTokens();
      queryClient.clear();
    },
  });
}
