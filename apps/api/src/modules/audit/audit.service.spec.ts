import { Test } from '@nestjs/testing';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from './audit.service';

describe('AuditService', () => {
  let service: AuditService;
  let prisma: { auditLog: { create: jest.Mock } };

  beforeEach(async () => {
    prisma = { auditLog: { create: jest.fn() } };

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
});
