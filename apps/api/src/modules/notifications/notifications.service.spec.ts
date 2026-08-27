import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let prisma: {
    notification: { create: jest.Mock; findMany: jest.Mock; findFirst: jest.Mock; update: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      notification: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
    };

    const module = await Test.createTestingModule({
      providers: [NotificationsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(NotificationsService);
  });

  describe('create', () => {
    it('grava a notificação para o usuário informado', async () => {
      const input = {
        organizationId: 'org-1',
        userId: 'user-1',
        type: 'task.assigned',
        payload: { taskId: 'task-1' },
      };
      const created = { id: 'notif-1', ...input };
      prisma.notification.create.mockResolvedValue(created);

      const result = await service.create(input);

      expect(prisma.notification.create).toHaveBeenCalledWith({ data: input });
      expect(result).toBe(created);
    });
  });

  describe('listForUser', () => {
    it('lista as notificações do usuário na organização, mais recentes primeiro', async () => {
      const notifications = [{ id: 'notif-2' }, { id: 'notif-1' }];
      prisma.notification.findMany.mockResolvedValue(notifications);

      const result = await service.listForUser('org-1', 'user-1');

      expect(prisma.notification.findMany).toHaveBeenCalledWith({
        where: { organizationId: 'org-1', userId: 'user-1' },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toBe(notifications);
    });
  });

  describe('markRead', () => {
    it('marca como lida quando a notificação pertence ao usuário', async () => {
      prisma.notification.findFirst.mockResolvedValue({ id: 'notif-1', readAt: null });
      const updated = { id: 'notif-1', readAt: new Date() };
      prisma.notification.update.mockResolvedValue(updated);

      const result = await service.markRead('org-1', 'user-1', 'notif-1');

      expect(prisma.notification.findFirst).toHaveBeenCalledWith({
        where: { id: 'notif-1', organizationId: 'org-1', userId: 'user-1' },
      });
      expect(prisma.notification.update).toHaveBeenCalledWith({
        where: { id: 'notif-1' },
        data: { readAt: expect.any(Date) },
      });
      expect(result).toBe(updated);
    });

    it('é idempotente — não atualiza de novo se já estava lida', async () => {
      const alreadyRead = { id: 'notif-1', readAt: new Date('2026-01-01') };
      prisma.notification.findFirst.mockResolvedValue(alreadyRead);

      const result = await service.markRead('org-1', 'user-1', 'notif-1');

      expect(prisma.notification.update).not.toHaveBeenCalled();
      expect(result).toBe(alreadyRead);
    });

    it('lança 404 quando a notificação não existe ou não pertence ao usuário', async () => {
      prisma.notification.findFirst.mockResolvedValue(null);

      await expect(service.markRead('org-1', 'user-1', 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
