'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ROLE_HIERARCHY, type Role } from '@opsmind/shared-types';
import {
  useCurrentMembership,
  useInviteMember,
  useMembers,
  usePendingInvitations,
  useRemoveMember,
  useUpdateMemberRole,
} from '@/lib/memberships/use-memberships';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Card, FormError } from '@/components/ui/card';

// Espelha os dois níveis de autorização do backend (mesma distinção de
// memberships.controller.ts/can-assign-role.ts) — só pra decidir o que
// MOSTRAR; a aplicação de verdade é sempre no servidor:
// 1) @Roles('OWNER','ADMIN') no controller: só esses dois papéis chegam
//    perto de convidar/trocar papel/remover, ponto final.
// 2) canAssignRole: dentro desse grupo, checagem fina — nunca agir sobre
//    alguém de papel igual ou superior ao seu (Admin não mexe em Owner).
const MANAGER_ROLES: Role[] = ['OWNER', 'ADMIN'];

function canAssignRole(actingRole: Role, otherRole: Role): boolean {
  return ROLE_HIERARCHY.indexOf(otherRole) > ROLE_HIERARCHY.indexOf(actingRole);
}

function assignableRoles(actingRole: Role): Role[] {
  return ROLE_HIERARCHY.filter((role) => canAssignRole(actingRole, role));
}

const inviteSchema = z.object({
  email: z.string().email('E-mail inválido'),
  role: z.string().min(1),
});

type InviteFormValues = z.infer<typeof inviteSchema>;

export default function TeamPage() {
  const { organizationId } = useParams<{ organizationId: string }>();
  const { membership: currentMembership, isLoading: loadingCurrentMembership } =
    useCurrentMembership(organizationId);
  const canManage = currentMembership ? MANAGER_ROLES.includes(currentMembership.role) : false;

  const members = useMembers(organizationId);
  const pendingInvitations = usePendingInvitations(organizationId, canManage);
  const inviteMember = useInviteMember(organizationId);
  const updateRole = useUpdateMemberRole(organizationId);
  const removeMember = useRemoveMember(organizationId);
  const [showInviteForm, setShowInviteForm] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<InviteFormValues>({ resolver: zodResolver(inviteSchema) });

  if (loadingCurrentMembership || members.isLoading) {
    return <p className="text-slate-500">Carregando equipe…</p>;
  }

  const options = currentMembership ? assignableRoles(currentMembership.role) : [];

  const onSubmit = handleSubmit((values) => {
    inviteMember.mutate(
      { email: values.email, role: values.role as Role },
      { onSuccess: () => { reset(); setShowInviteForm(false); } },
    );
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900">Membros</h1>
        {canManage && (
          <Button variant="secondary" onClick={() => setShowInviteForm((v) => !v)}>
            + Convidar
          </Button>
        )}
      </div>

      {showInviteForm && (
        <Card>
          <h2 className="font-medium text-slate-900">Convidar alguém</h2>
          <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start">
            <div className="flex-1">
              <Input type="email" placeholder="email@empresa.com" {...register('email')} />
              <FormError message={errors.email?.message} />
            </div>
            <div className="flex-1">
              <Select {...register('role')} defaultValue="">
                <option value="" disabled>
                  Papel
                </option>
                {options.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </Select>
              <FormError message={errors.role?.message} />
            </div>
            <Button type="submit" isLoading={inviteMember.isPending}>
              Enviar convite
            </Button>
          </form>
          <FormError message={inviteMember.isError ? (inviteMember.error as ApiError).message : null} />
        </Card>
      )}

      <div className="flex flex-col gap-2">
        {members.data?.map((member) => {
          const isSelf = member.userId === currentMembership?.userId;
          const canAct =
            canManage &&
            currentMembership !== undefined &&
            !isSelf &&
            canAssignRole(currentMembership.role, member.role);
          return (
            <Card key={member.id} className="flex items-center justify-between">
              <div>
                <p className="font-medium text-slate-900">
                  {member.user.name}
                  {isSelf && <span className="ml-2 text-xs text-slate-400">(você)</span>}
                </p>
                <p className="text-sm text-slate-500">{member.user.email}</p>
              </div>
              <div className="flex items-center gap-3">
                {canAct ? (
                  <Select
                    value={member.role}
                    onChange={(e) =>
                      updateRole.mutate({ userId: member.userId, role: e.target.value as Role })
                    }
                    className="w-32"
                  >
                    {ROLE_HIERARCHY.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Badge value={member.role} />
                )}
                {canAct && (
                  <Button
                    variant="ghost"
                    className="text-red-600"
                    onClick={() => removeMember.mutate(member.userId)}
                  >
                    Remover
                  </Button>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      {canManage && (
        <div>
          <h2 className="mb-2 font-medium text-slate-900">Convites pendentes</h2>
          {pendingInvitations.isLoading && <p className="text-sm text-slate-500">Carregando…</p>}
          {pendingInvitations.isSuccess && pendingInvitations.data.length === 0 && (
            <p className="text-sm text-slate-500">Nenhum convite pendente.</p>
          )}
          <div className="flex flex-col gap-2">
            {pendingInvitations.data?.map((invitation) => (
              <Card key={invitation.id} className="flex items-center justify-between">
                <p className="text-sm text-slate-700">{invitation.email}</p>
                <div className="flex items-center gap-3">
                  <Badge value={invitation.role} />
                  <span className="text-xs text-slate-400">
                    expira em {new Date(invitation.expiresAt).toLocaleDateString('pt-BR')}
                  </span>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
