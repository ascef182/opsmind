import { Injectable } from '@nestjs/common';
import type { AuditActorType, AuditLog, Prisma } from '@opsmind/database';
import { PrismaService } from '../../infrastructure/database/prisma.service';

export interface AuditLogInput {
  // Nullable: alguns eventos (ex.: "user.registered") acontecem antes de
  // qualquer organização existir (Decisão #8 do blueprint).
  organizationId?: string;
  actorType: AuditActorType;
  // Não é FK: o ator pode ser AI/system/automation, não só um User.
  actorId?: string;
  action: string;
  resource: string;
  metadata?: Prisma.InputJsonValue;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Auditoria via chamada explícita em cada service sensível, não um
 * interceptor genérico (Decisão #7 do blueprint) — mais simples de revisar,
 * `metadata` sempre preciso para quem chamou.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  log(input: AuditLogInput): Promise<AuditLog> {
    return this.prisma.auditLog.create({ data: input });
  }
}
