export type AuditActorType = 'USER' | 'AI' | 'SYSTEM' | 'AUTOMATION';

export interface AuditLogDto {
  id: string;
  organizationId: string | null;
  actorType: AuditActorType;
  actorId: string | null;
  action: string;
  resource: string;
  createdAt: string;
}
