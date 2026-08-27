import { randomBytes, createHash } from 'crypto';
import {
  ConflictException,
  ForbiddenException,
  GoneException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Invitation, Membership } from '@opsmind/database';
import type { Role } from '@opsmind/shared-types';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EMAIL_SERVICE, type EmailService } from '../../infrastructure/email/email.service';
import { canAssignRole } from '../../shared/utils/can-assign-role';

const INVITATION_TOKEN_BYTES = 32;
const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias (PRD §8)

export interface PendingInvitation {
  id: string;
  email: string;
  role: Role;
  expiresAt: Date;
  createdAt: Date;
}

export interface CreateInvitationInput {
  organizationId: string;
  invitedByUserId: string;
  inviterRole: Role;
  email: string;
  role: Role;
}

function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

@Injectable()
export class InvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    @Inject(EMAIL_SERVICE) private readonly emailService: EmailService,
  ) {}

  async create(input: CreateInvitationInput): Promise<Invitation> {
    // Regra de segurança da Fase 1: só Owner/Admin chegam aqui (RolesGuard no
    // controller); esta checagem cobre o caso mais fino — nunca convidar
    // papel igual ou superior ao do próprio convidador.
    if (!canAssignRole(input.inviterRole, input.role)) {
      throw new ForbiddenException(
        'Você não pode convidar alguém com papel igual ou superior ao seu',
      );
    }

    const existingMembership = await this.prisma.membership.findFirst({
      where: { organizationId: input.organizationId, user: { email: input.email } },
    });
    if (existingMembership) {
      throw new ConflictException('Este email já pertence a um membro desta organização');
    }

    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: input.organizationId },
    });

    const rawToken = randomBytes(INVITATION_TOKEN_BYTES).toString('hex');
    const invitation = await this.prisma.invitation.create({
      data: {
        organizationId: input.organizationId,
        email: input.email,
        role: input.role,
        tokenHash: hashToken(rawToken),
        invitedByUserId: input.invitedByUserId,
        expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
      },
    });

    await this.auditService.log({
      actorType: 'USER',
      actorId: input.invitedByUserId,
      organizationId: input.organizationId,
      action: 'membership.invited',
      resource: `Invitation:${invitation.id}`,
      metadata: { email: input.email, role: input.role },
    });

    await this.emailService.sendInvitationEmail({
      to: input.email,
      organizationName: organization.name,
      token: rawToken,
    });

    return invitation;
  }

  async accept(userId: string, userEmail: string, rawToken: string): Promise<Membership> {
    const invitation = await this.prisma.invitation.findUnique({
      where: { tokenHash: hashToken(rawToken) },
    });

    if (!invitation || invitation.status !== 'PENDING') {
      throw new NotFoundException('Convite inválido ou já utilizado');
    }

    if (invitation.expiresAt.getTime() < Date.now()) {
      throw new GoneException('Convite expirado');
    }

    if (invitation.email !== userEmail) {
      throw new ForbiddenException('Este convite foi endereçado a outro email');
    }

    const membership = await this.prisma.runInTransaction(async (tx) => {
      const created = await tx.membership.create({
        data: { userId, organizationId: invitation.organizationId, role: invitation.role },
      });
      await tx.invitation.update({
        where: { id: invitation.id },
        data: { status: 'ACCEPTED', acceptedAt: new Date() },
      });
      return created;
    });

    await this.auditService.log({
      actorType: 'USER',
      actorId: userId,
      organizationId: invitation.organizationId,
      action: 'membership.accepted',
      resource: `Membership:${membership.id}`,
    });

    return membership;
  }

  /**
   * `select` explícito (nunca um `findMany` genérico + descartar campos
   * depois) — `tokenHash` é a única coisa que autentica um `accept()`, então
   * não pode vazar por nenhuma rota de leitura, nem por engano numa mudança
   * futura de schema que adicione um campo novo ao model.
   */
  listPendingForOrganization(organizationId: string): Promise<PendingInvitation[]> {
    return this.prisma.invitation.findMany({
      where: { organizationId, status: 'PENDING' },
      select: { id: true, email: true, role: true, expiresAt: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }
}
