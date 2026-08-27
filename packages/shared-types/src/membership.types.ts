export type Role = 'OWNER' | 'ADMIN' | 'MANAGER' | 'MEMBER' | 'VIEWER';

/** Hierarquia linear: papel de índice N pode tudo que papéis de índice > N podem. */
export const ROLE_HIERARCHY: Role[] = ['OWNER', 'ADMIN', 'MANAGER', 'MEMBER', 'VIEWER'];

export interface MembershipDto {
  id: string;
  userId: string;
  organizationId: string;
  role: Role;
}
