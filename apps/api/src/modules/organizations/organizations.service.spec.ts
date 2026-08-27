import { ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationsService } from './organizations.service';

describe('OrganizationsService', () => {
  let service: OrganizationsService;
  let prisma: {
    $transaction: jest.Mock;
    organization: { findFirst: jest.Mock; findMany: jest.Mock };
  };
  type Tx = { organization: { create: jest.Mock }; membership: { create: jest.Mock } };
  let tx: Tx;
  let auditService: { log: jest.Mock };

  beforeEach(async () => {
    tx = {
      organization: { create: jest.fn() },
      membership: { create: jest.fn() },
    };
    prisma = {
      $transaction: jest.fn((callback: (tx: Tx) => unknown) => callback(tx)),
      organization: { findFirst: jest.fn(), findMany: jest.fn() },
    };
    auditService = { log: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        OrganizationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    service = module.get(OrganizationsService);
  });

  describe('create', () => {
    it('cria a organização e um Membership OWNER numa única transação', async () => {
      const org = { id: 'org-1', name: 'Acme', slug: 'acme' };
      tx.organization.create.mockResolvedValue(org);
      tx.membership.create.mockResolvedValue({
        id: 'm-1',
        userId: 'user-1',
        organizationId: 'org-1',
        role: 'OWNER',
      });

      const result = await service.create('user-1', { name: 'Acme', slug: 'acme' });

      expect(tx.organization.create).toHaveBeenCalledWith({ data: { name: 'Acme', slug: 'acme' } });
      expect(tx.membership.create).toHaveBeenCalledWith({
        data: { userId: 'user-1', organizationId: 'org-1', role: 'OWNER' },
      });
      expect(result).toBe(org);
    });

    it('gera o slug a partir do nome quando ele não é informado', async () => {
      tx.organization.create.mockResolvedValue({ id: 'org-2', name: 'Acme Inc.', slug: 'acme-inc' });
      tx.membership.create.mockResolvedValue({});

      await service.create('user-1', { name: 'Acme Inc.' });

      expect(tx.organization.create).toHaveBeenCalledWith({
        data: { name: 'Acme Inc.', slug: 'acme-inc' },
      });
    });

    it('audita a criação com organizationId e o usuário como OWNER', async () => {
      const org = { id: 'org-1', name: 'Acme', slug: 'acme' };
      tx.organization.create.mockResolvedValue(org);
      tx.membership.create.mockResolvedValue({});

      await service.create('user-1', { name: 'Acme', slug: 'acme' });

      expect(auditService.log).toHaveBeenCalledWith({
        actorType: 'USER',
        actorId: 'user-1',
        organizationId: 'org-1',
        action: 'organization.created',
        resource: 'Organization:org-1',
      });
    });

    it('traduz colisão de slug (unique constraint) em ConflictException', async () => {
      const prismaError = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
      prisma.$transaction.mockRejectedValue(prismaError);

      await expect(service.create('user-1', { name: 'Acme', slug: 'acme' })).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('findByIdForUser', () => {
    it('retorna a organização quando o usuário é membro dela', async () => {
      const org = { id: 'org-1', name: 'Acme', slug: 'acme' };
      prisma.organization.findFirst.mockResolvedValue(org);

      const result = await service.findByIdForUser('org-1', 'user-1');

      expect(prisma.organization.findFirst).toHaveBeenCalledWith({
        where: { id: 'org-1', memberships: { some: { userId: 'user-1' } } },
      });
      expect(result).toBe(org);
    });

    it('retorna null quando o usuário não é membro — sem confirmar se a org existe', async () => {
      prisma.organization.findFirst.mockResolvedValue(null);

      const result = await service.findByIdForUser('org-1', 'stranger');

      expect(result).toBeNull();
    });
  });

  describe('listForUser', () => {
    it('lista as organizações das quais o usuário é membro', async () => {
      const orgs = [{ id: 'org-1' }, { id: 'org-2' }];
      prisma.organization.findMany.mockResolvedValue(orgs);

      const result = await service.listForUser('user-1');

      expect(prisma.organization.findMany).toHaveBeenCalledWith({
        where: { memberships: { some: { userId: 'user-1' } } },
      });
      expect(result).toBe(orgs);
    });
  });
});
