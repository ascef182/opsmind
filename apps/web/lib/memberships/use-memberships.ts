'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Role } from '@opsmind/shared-types';
import { apiFetch } from '../api-client';
import { useCurrentUser } from '../auth/use-auth';
import type { InviteMemberInput, Member, PendingInvitation } from './types';

export function useMembers(organizationId: string) {
  return useQuery({
    queryKey: ['organizations', organizationId, 'members'],
    queryFn: () => apiFetch<Member[]>(`/organizations/${organizationId}/members`),
    enabled: Boolean(organizationId),
  });
}

export function usePendingInvitations(organizationId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['organizations', organizationId, 'invitations'],
    queryFn: () => apiFetch<PendingInvitation[]>(`/organizations/${organizationId}/invitations`),
    // Só quem gerencia a equipe (OWNER/ADMIN) tem acesso — pedir de qualquer
    // jeito pra outros papéis só gera um 403 previsível; `enabled` evita a
    // request. Ver useCurrentMembership.
    enabled: Boolean(organizationId) && enabled,
  });
}

/**
 * Não existe um endpoint "qual é o meu papel aqui" — deriva da lista de
 * membros (que todo membro pode ler) cruzada com o usuário autenticado
 * (`GET /auth/me`). Usada pra decidir o que mostrar na tela de equipe
 * (convidar, trocar papel, remover) antes mesmo de a API rejeitar.
 */
export function useCurrentMembership(organizationId: string) {
  const currentUser = useCurrentUser();
  const members = useMembers(organizationId);
  const membership = members.data?.find((m) => m.userId === currentUser.data?.id);
  return { membership, isLoading: currentUser.isLoading || members.isLoading };
}

export function useInviteMember(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: InviteMemberInput) =>
      apiFetch(`/organizations/${organizationId}/invite`, { method: 'POST', body: input }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['organizations', organizationId, 'invitations'] }),
  });
}

export function useUpdateMemberRole(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: Role }) =>
      apiFetch<Member>(`/organizations/${organizationId}/members/${userId}`, {
        method: 'PATCH',
        body: { role },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['organizations', organizationId, 'members'] }),
  });
}

export function useRemoveMember(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      apiFetch(`/organizations/${organizationId}/members/${userId}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['organizations', organizationId, 'members'] }),
  });
}
