import { Test } from '@nestjs/testing';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { ActivityService } from './activity.service';

describe('ActivityService', () => {
  let service: ActivityService;
  let prisma: {
    $transaction: jest.Mock;
    activityLog: { create: jest.Mock; findMany: jest.Mock };
    customer: { update: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      $transaction: jest.fn((operations: Promise<unknown>[]) => Promise.all(operations)),
      activityLog: { create: jest.fn(), findMany: jest.fn() },
      customer: { update: jest.fn() },
    };

    const module = await Test.createTestingModule({
      providers: [ActivityService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(ActivityService);
  });

  describe('log', () => {
    it('grava a atividade e atualiza customer.lastActivityAt, na mesma transação', async () => {
      const activity = { id: 'act-1', type: 'note.added' };
      prisma.activityLog.create.mockResolvedValue(activity);
      prisma.customer.update.mockResolvedValue({ id: 'cust-1' });

      const input = {
        organizationId: 'org-1',
        customerId: 'cust-1',
        type: 'note.added',
        actorType: 'USER' as const,
        actorId: 'user-1',
        payload: { note: 'ligou hoje' },
      };

      const result = await service.log(input);

      expect(prisma.activityLog.create).toHaveBeenCalledWith({ data: input });
      expect(prisma.customer.update).toHaveBeenCalledWith({
        where: { id: 'cust-1' },
        data: { lastActivityAt: expect.any(Date) },
      });
      expect(result).toBe(activity);
    });
  });

  describe('listForCustomer', () => {
    it('lista as atividades do cliente, mais recentes primeiro', async () => {
      const logs = [{ id: 'act-2' }, { id: 'act-1' }];
      prisma.activityLog.findMany.mockResolvedValue(logs);

      const result = await service.listForCustomer('org-1', 'cust-1');

      expect(prisma.activityLog.findMany).toHaveBeenCalledWith({
        where: { organizationId: 'org-1', customerId: 'cust-1' },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toBe(logs);
    });
  });
});
