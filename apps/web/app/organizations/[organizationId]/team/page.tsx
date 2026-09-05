'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { MoreHorizontalIcon } from 'lucide-react';
import { ROLE_HIERARCHY, type Role } from '@opsmind/shared-types';
import {
  useCurrentMembership,
  useInviteMember,
  useMembers,
  usePendingInvitations,
  useRemoveMember,
  useUpdateMemberRole,
} from '@/lib/memberships/use-memberships';
import type { Member } from '@/lib/memberships/types';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { FormError } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

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

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
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
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [removingMember, setRemovingMember] = useState<Member | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<InviteFormValues>({ resolver: zodResolver(inviteSchema) });

  if (loadingCurrentMembership || members.isLoading) {
    return <p className="text-muted-foreground">Carregando equipe…</p>;
  }

  const options = currentMembership ? assignableRoles(currentMembership.role) : [];

  const onSubmit = handleSubmit((values) => {
    inviteMember.mutate(
      { email: values.email, role: values.role as Role },
      { onSuccess: () => { reset(); setInviteDialogOpen(false); } },
    );
  });

  function confirmRemove() {
    if (!removingMember) return;
    removeMember.mutate(removingMember.userId, { onSuccess: () => setRemovingMember(null) });
  }

  const membersTable = (
    <div className="rounded-lg border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Membro</TableHead>
            <TableHead>Papel</TableHead>
            {canManage && <TableHead className="text-right">Ações</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.data?.map((member) => {
            const isSelf = member.userId === currentMembership?.userId;
            const canAct =
              canManage &&
              currentMembership !== undefined &&
              !isSelf &&
              canAssignRole(currentMembership.role, member.role);
            return (
              <TableRow key={member.id}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <Avatar size="sm">
                      <AvatarFallback>{initials(member.user.name)}</AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-medium text-foreground">
                        {member.user.name}
                        {isSelf && <span className="ml-2 text-xs text-muted-foreground">(você)</span>}
                      </p>
                      <p className="text-xs text-muted-foreground">{member.user.email}</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge value={member.role} />
                </TableCell>
                {canManage && (
                  <TableCell className="text-right">
                    {canAct && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontalIcon />
                            <span className="sr-only">Ações</span>
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {assignableRoles(currentMembership!.role).map((role) => (
                            <DropdownMenuItem
                              key={role}
                              disabled={role === member.role}
                              onSelect={() => updateRole.mutate({ userId: member.userId, role })}
                            >
                              Definir como {role}
                            </DropdownMenuItem>
                          ))}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant="destructive" onSelect={() => setRemovingMember(member)}>
                            Remover da equipe
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-foreground">Equipe</h1>
        {canManage && (
          <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
            <Button variant="secondary" onClick={() => setInviteDialogOpen(true)}>
              + Convidar
            </Button>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Convidar alguém</DialogTitle>
              </DialogHeader>
              <form onSubmit={onSubmit} className="flex flex-col gap-4">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">E-mail</label>
                  <Input type="email" placeholder="email@empresa.com" {...register('email')} />
                  <FormError message={errors.email?.message} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Papel</label>
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
                <FormError message={inviteMember.isError ? (inviteMember.error as ApiError).message : null} />
                <DialogFooter>
                  <Button type="submit" isLoading={inviteMember.isPending}>
                    Enviar convite
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {canManage ? (
        <Tabs defaultValue="members">
          <TabsList>
            <TabsTrigger value="members">Membros</TabsTrigger>
            <TabsTrigger value="invitations">Convites pendentes</TabsTrigger>
          </TabsList>
          <TabsContent value="members" className="mt-4">
            {membersTable}
          </TabsContent>
          <TabsContent value="invitations" className="mt-4">
            {pendingInvitations.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
            {pendingInvitations.isSuccess && pendingInvitations.data.length === 0 && (
              <p className="text-sm text-muted-foreground">Nenhum convite pendente.</p>
            )}
            {pendingInvitations.isSuccess && pendingInvitations.data.length > 0 && (
              <div className="rounded-lg border border-border bg-card">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>E-mail</TableHead>
                      <TableHead>Papel</TableHead>
                      <TableHead>Expira em</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pendingInvitations.data.map((invitation) => (
                      <TableRow key={invitation.id}>
                        <TableCell className="text-foreground/80">{invitation.email}</TableCell>
                        <TableCell>
                          <Badge value={invitation.role} />
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {new Date(invitation.expiresAt).toLocaleDateString('pt-BR')}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>
        </Tabs>
      ) : (
        membersTable
      )}

      <Dialog open={removingMember !== null} onOpenChange={(open) => !open && setRemovingMember(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remover da equipe</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Tem certeza que quer remover <span className="text-foreground">{removingMember?.user.name}</span> da
            equipe? Essa ação não pode ser desfeita.
          </p>
          <FormError message={removeMember.isError ? (removeMember.error as ApiError).message : null} />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setRemovingMember(null)}>
              Cancelar
            </Button>
            <Button
              className="bg-destructive text-destructive-foreground hover:opacity-90"
              isLoading={removeMember.isPending}
              onClick={confirmRemove}
            >
              Remover
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
