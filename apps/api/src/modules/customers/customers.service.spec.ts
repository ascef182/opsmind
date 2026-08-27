import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ActivityService } from '../activity/activity.service';
import { CustomersService } from './customers.service';

describe('CustomersService', () => {
  let service: CustomersService;
  let prisma: {
    customer: { create: jest.Mock; findFirst: jest.Mock; findMany: jest.Mock; update: jest.Mock };
  };
  let auditService: { log: jest.Mock };
  let activityService: { log: jest.Mock };

  beforeEach(async () => {
    prisma = {
      customer: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
    };
    auditService = { log: jest.fn() };
    activityService = { log: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        CustomersService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: auditService },
        { provide: ActivityService, useValue: activityService },
      ],
    }).compile();

    service = module.get(CustomersService);
  });

  describe('create', () => {
    it('cria o cliente escopado à organização e audita', async () => {
      const created = { id: 'cust-1', organizationId: 'org-1', name: 'Acme' };
      prisma.customer.create.mockResolvedValue(created);

      const result = await service.create('org-1', { name: 'Acme' }, 'user-1');

      expect(prisma.customer.create).toHaveBeenCalledWith({
        data: { organizationId: 'org-1', name: 'Acme' },
      });
      expect(auditService.log).toHaveBeenCalledWith({
        actorType: 'USER',
        actorId: 'user-1',
        organizationId: 'org-1',
        action: 'customer.created',
        resource: 'Customer:cust-1',
      });
      expect(result).toBe(created);
    });
  });

  describe('findByIdOrThrow', () => {
    it('retorna o cliente quando existe, pertence à org e não foi excluído', async () => {
      const customer = { id: 'cust-1', organizationId: 'org-1', deletedAt: null };
      prisma.customer.findFirst.mockResolvedValue(customer);

      const result = await service.findByIdOrThrow('org-1', 'cust-1');

      expect(prisma.customer.findFirst).toHaveBeenCalledWith({
        where: { id: 'cust-1', organizationId: 'org-1', deletedAt: null },
      });
      expect(result).toBe(customer);
    });

    it('lança 404 quando o cliente não existe, é de outra org, ou foi excluído', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);

      await expect(service.findByIdOrThrow('org-1', 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('list', () => {
    it('lista clientes não excluídos da organização, sem filtros extras', async () => {
      const customers = [{ id: 'cust-1' }];
      prisma.customer.findMany.mockResolvedValue(customers);

      const result = await service.list('org-1', {});

      expect(prisma.customer.findMany).toHaveBeenCalledWith({
        where: { organizationId: 'org-1', deletedAt: null },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toBe(customers);
    });

    it('aplica filtro de status, tag e busca por nome quando informados', async () => {
      prisma.customer.findMany.mockResolvedValue([]);

      await service.list('org-1', { status: 'ACTIVE', tag: 'vip', search: 'acme' });

      expect(prisma.customer.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: 'org-1',
          deletedAt: null,
          status: 'ACTIVE',
          tags: { has: 'vip' },
          name: { contains: 'acme', mode: 'insensitive' },
        },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('update', () => {
    it('atualiza o cliente e audita, com o cliente já validado (org + não excluído)', async () => {
      prisma.customer.findFirst.mockResolvedValue({ id: 'cust-1', organizationId: 'org-1' });
      const updated = { id: 'cust-1', status: 'INACTIVE' };
      prisma.customer.update.mockResolvedValue(updated);

      const result = await service.update('org-1', 'cust-1', { status: 'INACTIVE' }, 'user-1');

      expect(prisma.customer.update).toHaveBeenCalledWith({
        where: { id: 'cust-1' },
        data: { status: 'INACTIVE' },
      });
      expect(auditService.log).toHaveBeenCalledWith({
        actorType: 'USER',
        actorId: 'user-1',
        organizationId: 'org-1',
        action: 'customer.updated',
        resource: 'Customer:cust-1',
        metadata: { status: 'INACTIVE' },
      });
      expect(result).toBe(updated);
    });

    it('lança 404 ao tentar atualizar cliente que não existe/não pertence à org', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);

      await expect(
        service.update('org-1', 'missing', { status: 'INACTIVE' }, 'user-1'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.customer.update).not.toHaveBeenCalled();
    });
  });

  describe('softDelete', () => {
    it('marca deletedAt em vez de apagar a linha, e audita', async () => {
      prisma.customer.findFirst.mockResolvedValue({ id: 'cust-1', organizationId: 'org-1' });

      await service.softDelete('org-1', 'cust-1', 'user-1');

      expect(prisma.customer.update).toHaveBeenCalledWith({
        where: { id: 'cust-1' },
        data: { deletedAt: expect.any(Date) },
      });
      expect(auditService.log).toHaveBeenCalledWith({
        actorType: 'USER',
        actorId: 'user-1',
        organizationId: 'org-1',
        action: 'customer.deleted',
        resource: 'Customer:cust-1',
      });
    });
  });

  describe('addNote', () => {
    it('valida o cliente (org + não excluído) e registra a nota como atividade', async () => {
      prisma.customer.findFirst.mockResolvedValue({ id: 'cust-1', organizationId: 'org-1' });
      const activity = { id: 'act-1', type: 'note.added' };
      activityService.log.mockResolvedValue(activity);

      const result = await service.addNote('org-1', 'cust-1', 'Ligou hoje', 'user-1');

      expect(activityService.log).toHaveBeenCalledWith({
        organizationId: 'org-1',
        customerId: 'cust-1',
        type: 'note.added',
        actorType: 'USER',
        actorId: 'user-1',
        payload: { note: 'Ligou hoje' },
      });
      expect(result).toBe(activity);
    });

    it('lança 404 ao anotar em cliente que não existe/não pertence à org', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);

      await expect(service.addNote('org-1', 'missing', 'nota', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(activityService.log).not.toHaveBeenCalled();
    });
  });
});
