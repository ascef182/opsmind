import type { Role } from '@opsmind/shared-types';

// Espelha MembershipWithUser de apps/api/src/modules/memberships/memberships.service.ts.
export interface Member {
  id: string;
  userId: string;
  organizationId: string;
  role: Role;
  createdAt: string;
  user: {
    id: string;
    email: string;
    name: string;
  };
}

// Espelha PendingInvitation de apps/api — nunca inclui tokenHash (a API já
// garante isso via `select` explícito; o tipo aqui só documenta o contrato).
export interface PendingInvitation {
  id: string;
  email: string;
  role: Role;
  expiresAt: string;
  createdAt: string;
}

export interface InviteMemberInput {
  email: string;
  role: Role;
}
