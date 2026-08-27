import { createHash } from 'crypto';
import { ConflictException, ForbiddenException, GoneException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EMAIL_SERVICE } from '../../infrastructure/email/email.service';
import { InvitationsService } from './invitations.service';

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

describe('InvitationsService', () => {
  let service: InvitationsService;
  let prisma: {
    membership: { findFirst: jest.Mock; create: jest.Mock };
    organization: { findUniqueOrThrow: jest.Mock };
    invitation: { create: jest.Mock; findUnique: jest.Mock; update: jest.Mock; findMany: jest.Mock };
    runInTransaction: jest.Mock;
  };
  let auditService: { log: jest.Mock };
  let emailService: { sendInvitationEmail: jest.Mock };

  beforeEach(async () => {
    prisma = {
      membership: { findFirst: jest.fn(), create: jest.fn() },
      organization: { findUniqueOrThrow: jest.fn() },
      invitation: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn() },
      runInTransaction: jest.fn(),
    };
    auditService = { log: jest.fn() };
    emailService = { sendInvitationEmail: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        InvitationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: auditService },
        { provide: EMAIL_SERVICE, useValue: emailService },
      ],
    }).compile();

    service = module.get(InvitationsService);
  });

  describe('create', () => {
    const baseInput = {
      organizationId: 'org-1',
      invitedByUserId: 'user-owner',
      inviterRole: 'OWNER' as const,
      email: 'b@b.com',
      role: 'MEMBER' as const,
    };

    beforeEach(() => {
      prisma.membership.findFirst.mockResolvedValue(null);
      prisma.organization.findUniqueOrThrow.mockResolvedValue({ id: 'org-1', name: 'Acme' });
      prisma.invitation.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'inv-1', ...data }),
      );
    });

    it('rejeita convite para um papel igual ou superior ao do convidador', async () => {
      await expect(
        service.create({ ...baseInput, inviterRole: 'ADMIN', role: 'ADMIN' }),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.invitation.create).not.toHaveBeenCalled();
    });

    it('rejeita convite para email já membro da organização', async () => {
      prisma.membership.findFirst.mockResolvedValue({ id: 'm-existing' });

      await expect(service.create(baseInput)).rejects.toThrow(ConflictException);
      expect(prisma.invitation.create).not.toHaveBeenCalled();
    });

    it('cria o convite persistindo apenas o hash do token, expira em 7 dias', async () => {
      const before = Date.now();

      await service.create(baseInput);

      const createCall = prisma.invitation.create.mock.calls[0][0];
      expect(createCall.data.organizationId).toBe('org-1');
      expect(createCall.data.email).toBe('b@b.com');
      expect(createCall.data.role).toBe('MEMBER');
      expect(createCall.data.invitedByUserId).toBe('user-owner');
      expect(createCall.data.tokenHash).toEqual(expect.any(String));

      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      expect(createCall.data.expiresAt.getTime()).toBeGreaterThanOrEqual(
        before + sevenDaysMs - 1000,
      );
    });

    it('envia o email com o token bruto (nunca o hash) e audita o convite', async () => {
      await service.create(baseInput);

      const rawToken = emailService.sendInvitationEmail.mock.calls[0][0].token;
      const persistedHash = prisma.invitation.create.mock.calls[0][0].data.tokenHash;
      expect(persistedHash).toBe(sha256(rawToken));
      expect(emailService.sendInvitationEmail).toHaveBeenCalledWith({
        to: 'b@b.com',
        organizationName: 'Acme',
        token: rawToken,
      });

      expect(auditService.log).toHaveBeenCalledWith({
        actorType: 'USER',
        actorId: 'user-owner',
        organizationId: 'org-1',
        action: 'membership.invited',
        resource: 'Invitation:inv-1',
        metadata: { email: 'b@b.com', role: 'MEMBER' },
      });
    });
  });

  describe('accept', () => {
    it('rejeita token inexistente', async () => {
      prisma.invitation.findUnique.mockResolvedValue(null);

      await expect(service.accept('user-2', 'b@b.com', 'bad-token')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejeita convite já aceito/revogado', async () => {
      prisma.invitation.findUnique.mockResolvedValue({ id: 'inv-1', status: 'ACCEPTED' });

      await expect(service.accept('user-2', 'b@b.com', 'used-token')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejeita convite expirado', async () => {
      prisma.invitation.findUnique.mockResolvedValue({
        id: 'inv-1',
        status: 'PENDING',
        email: 'b@b.com',
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(service.accept('user-2', 'b@b.com', 'expired-token')).rejects.toThrow(
        GoneException,
      );
    });

    it('rejeita quando o email do usuário autenticado não bate com o do convite', async () => {
      prisma.invitation.findUnique.mockResolvedValue({
        id: 'inv-1',
        status: 'PENDING',
        email: 'b@b.com',
        expiresAt: new Date(Date.now() + 1000 * 60),
      });

      await expect(service.accept('user-2', 'someone-else@b.com', 'token')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('cria o Membership, marca o convite como aceito e audita, numa transação', async () => {
      const invitation = {
        id: 'inv-1',
        status: 'PENDING',
        email: 'b@b.com',
        organizationId: 'org-1',
        role: 'MEMBER',
        expiresAt: new Date(Date.now() + 1000 * 60),
      };
      prisma.invitation.findUnique.mockResolvedValue(invitation);
      const membership = { id: 'm-1', userId: 'user-2', organizationId: 'org-1', role: 'MEMBER' };
      type Tx = { membership: { create: jest.Mock }; invitation: { update: jest.Mock } };
      const tx: Tx = {
        membership: { create: jest.fn().mockResolvedValue(membership) },
        invitation: { update: jest.fn() },
      };
      prisma.runInTransaction.mockImplementation((cb: (tx: Tx) => unknown) => cb(tx));

      const result = await service.accept('user-2', 'b@b.com', 'good-token');

      expect(tx.membership.create).toHaveBeenCalledWith({
        data: { userId: 'user-2', organizationId: 'org-1', role: 'MEMBER' },
      });
      expect(tx.invitation.update).toHaveBeenCalledWith({
        where: { id: 'inv-1' },
        data: { status: 'ACCEPTED', acceptedAt: expect.any(Date) },
      });
      expect(auditService.log).toHaveBeenCalledWith({
        actorType: 'USER',
        actorId: 'user-2',
        organizationId: 'org-1',
        action: 'membership.accepted',
        resource: 'Membership:m-1',
      });
      expect(result).toBe(membership);
    });
  });

  describe('listPendingForOrganization', () => {
    it('lista só convites PENDING da organização, sem o tokenHash', async () => {
      const pending = [
        { id: 'inv-1', email: 'b@b.com', role: 'MEMBER', expiresAt: new Date(), createdAt: new Date() },
      ];
      prisma.invitation.findMany.mockResolvedValue(pending);

      const result = await service.listPendingForOrganization('org-1');

      expect(prisma.invitation.findMany).toHaveBeenCalledWith({
        where: { organizationId: 'org-1', status: 'PENDING' },
        select: { id: true, email: true, role: true, expiresAt: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toBe(pending);
    });
  });
});
