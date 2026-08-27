import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Membership } from '@opsmind/database';
import type { Role } from '@opsmind/shared-types';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { canAssignRole } from '../../shared/utils/can-assign-role';

interface ActingMembership {
  userId: string;
  role: Role;
}

export interface MembershipWithUser extends Membership {
  user: { id: string; email: string; name: string };
}

@Injectable()
export class MembershipsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  listForOrganization(organizationId: string): Promise<MembershipWithUser[]> {
    return this.prisma.membership.findMany({
      where: { organizationId },
      include: { user: { select: { id: true, email: true, name: true } } },
    });
  }

  async updateRole(
    organizationId: string,
    targetUserId: string,
    newRole: Role,
    actingMembership: ActingMembership,
  ): Promise<Membership> {
    // Regra de segurança da Fase 1: nunca promover alguém a papel igual ou
    // superior ao de quem está fazendo a mudança (evita um Admin criar outro
    // Admin/Owner, mesmo já tendo passado pelo RolesGuard no controller).
    if (!canAssignRole(actingMembership.role, newRole)) {
      throw new ForbiddenException('Você não pode atribuir um papel igual ou superior ao seu');
    }

    const target = await this.findMembershipOrThrow(organizationId, targetUserId);

    const updated = await this.prisma.membership.update({
      where: { id: target.id },
      data: { role: newRole },
    });

    await this.auditService.log({
      actorType: 'USER',
      actorId: actingMembership.userId,
      organizationId,
      action: 'membership.role_updated',
      resource: `Membership:${updated.id}`,
      metadata: { targetUserId, previousRole: target.role, newRole },
    });

    return updated;
  }

  async remove(
    organizationId: string,
    targetUserId: string,
    actingMembership: ActingMembership,
  ): Promise<void> {
    const target = await this.findMembershipOrThrow(organizationId, targetUserId);

    if (!canAssignRole(actingMembership.role, target.role as Role)) {
      throw new ForbiddenException(
        'Você não pode remover alguém com papel igual ou superior ao seu',
      );
    }

    await this.prisma.membership.delete({ where: { id: target.id } });

    await this.auditService.log({
      actorType: 'USER',
      actorId: actingMembership.userId,
      organizationId,
      action: 'membership.removed',
      resource: `Membership:${target.id}`,
      metadata: { targetUserId, role: target.role },
    });
  }

  private async findMembershipOrThrow(
    organizationId: string,
    userId: string,
  ): Promise<Membership> {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
    });
    if (!membership) {
      throw new NotFoundException('Membro não encontrado nesta organização');
    }
    return membership;
  }
}
