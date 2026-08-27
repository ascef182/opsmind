import { Test } from '@nestjs/testing';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from './audit.service';

describe('AuditService', () => {
  let service: AuditService;
  let prisma: { auditLog: { create: jest.Mock; findMany: jest.Mock } };

  beforeEach(async () => {
    prisma = { auditLog: { create: jest.fn(), findMany: jest.fn() } };

    const module = await Test.createTestingModule({
      providers: [AuditService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(AuditService);
  });

  describe('log', () => {
    it('grava o evento com todos os campos informados', async () => {
      const entry = {
        organizationId: 'org-1',
        actorType: 'USER' as const,
        actorId: 'user-1',
        action: 'user.registered',
        resource: 'User:user-1',
        metadata: { note: 'via signup form' },
        ipAddress: '127.0.0.1',
        userAgent: 'jest',
      };
      prisma.auditLog.create.mockResolvedValue({ id: 'log-1', ...entry });

      await service.log(entry);

      expect(prisma.auditLog.create).toHaveBeenCalledWith({ data: entry });
    });

    it('aceita organizationId ausente — user.registered acontece antes de qualquer organização existir (Decisão #8)', async () => {
      const entry = {
        actorType: 'USER' as const,
        actorId: 'user-1',
        action: 'user.registered',
        resource: 'User:user-1',
      };
      prisma.auditLog.create.mockResolvedValue({ id: 'log-1', ...entry });

      await service.log(entry);

      expect(prisma.auditLog.create).toHaveBeenCalledWith({ data: entry });
    });
  });

  describe('listForOrganization', () => {
    it('lista os eventos da organização, mais recentes primeiro', async () => {
      const logs = [{ id: 'log-2' }, { id: 'log-1' }];
      prisma.auditLog.findMany.mockResolvedValue(logs);

      const result = await service.listForOrganization('org-1');

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
        where: { organizationId: 'org-1' },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toBe(logs);
    });
  });
});
