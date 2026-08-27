import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MembershipsService } from './memberships.service';

describe('MembershipsService', () => {
  let service: MembershipsService;
  let prisma: {
    membership: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
  };
  let auditService: { log: jest.Mock };

  const actingMembership = { userId: 'user-owner', role: 'OWNER' as const };

  beforeEach(async () => {
    prisma = {
      membership: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };
    auditService = { log: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        MembershipsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    service = module.get(MembershipsService);
  });

  describe('listForOrganization', () => {
    it('lista os memberships da organização com dados do usuário', async () => {
      const memberships = [{ id: 'm-1', role: 'OWNER', user: { email: 'a@a.com' } }];
      prisma.membership.findMany.mockResolvedValue(memberships);

      const result = await service.listForOrganization('org-1');

      expect(prisma.membership.findMany).toHaveBeenCalledWith({
        where: { organizationId: 'org-1' },
        include: { user: { select: { id: true, email: true, name: true } } },
      });
      expect(result).toBe(memberships);
    });
  });

  describe('updateRole', () => {
    it('rejeita atribuir papel igual ou superior ao de quem está atualizando', async () => {
      await expect(
        service.updateRole('org-1', 'user-2', 'OWNER', actingMembership),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.membership.update).not.toHaveBeenCalled();
    });

    it('rejeita quando o membro alvo não existe na organização', async () => {
      prisma.membership.findUnique.mockResolvedValue(null);

      await expect(
        service.updateRole('org-1', 'user-2', 'ADMIN', actingMembership),
      ).rejects.toThrow(NotFoundException);
    });

    it('atualiza o papel e audita a mudança', async () => {
      prisma.membership.findUnique.mockResolvedValue({
        id: 'm-2',
        userId: 'user-2',
        organizationId: 'org-1',
        role: 'MEMBER',
      });
      prisma.membership.update.mockResolvedValue({
        id: 'm-2',
        userId: 'user-2',
        organizationId: 'org-1',
        role: 'ADMIN',
      });

      const result = await service.updateRole('org-1', 'user-2', 'ADMIN', actingMembership);

      expect(prisma.membership.update).toHaveBeenCalledWith({
        where: { id: 'm-2' },
        data: { role: 'ADMIN' },
      });
      expect(auditService.log).toHaveBeenCalledWith({
        actorType: 'USER',
        actorId: 'user-owner',
        organizationId: 'org-1',
        action: 'membership.role_updated',
        resource: 'Membership:m-2',
        metadata: { targetUserId: 'user-2', previousRole: 'MEMBER', newRole: 'ADMIN' },
      });
      expect(result.role).toBe('ADMIN');
    });
  });

  describe('remove', () => {
    it('rejeita quando o membro alvo não existe na organização', async () => {
      prisma.membership.findUnique.mockResolvedValue(null);

      await expect(service.remove('org-1', 'user-2', actingMembership)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejeita remover alguém com papel igual ou superior ao de quem está removendo', async () => {
      prisma.membership.findUnique.mockResolvedValue({
        id: 'm-2',
        userId: 'user-2',
        organizationId: 'org-1',
        role: 'OWNER',
      });

      await expect(service.remove('org-1', 'user-2', actingMembership)).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.membership.delete).not.toHaveBeenCalled();
    });

    it('remove o membership e audita a remoção', async () => {
      prisma.membership.findUnique.mockResolvedValue({
        id: 'm-2',
        userId: 'user-2',
        organizationId: 'org-1',
        role: 'MEMBER',
      });

      await service.remove('org-1', 'user-2', actingMembership);

      expect(prisma.membership.delete).toHaveBeenCalledWith({ where: { id: 'm-2' } });
      expect(auditService.log).toHaveBeenCalledWith({
        actorType: 'USER',
        actorId: 'user-owner',
        organizationId: 'org-1',
        action: 'membership.removed',
        resource: 'Membership:m-2',
        metadata: { targetUserId: 'user-2', role: 'MEMBER' },
      });
    });
  });
});
