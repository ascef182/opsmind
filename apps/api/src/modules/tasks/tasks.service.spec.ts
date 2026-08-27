import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ActivityService } from '../activity/activity.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TasksService } from './tasks.service';

describe('TasksService', () => {
  let service: TasksService;
  let prisma: {
    task: { create: jest.Mock; findFirst: jest.Mock; findMany: jest.Mock; update: jest.Mock };
    customer: { findFirst: jest.Mock };
    membership: { findUnique: jest.Mock };
  };
  let auditService: { log: jest.Mock };
  let activityService: { log: jest.Mock };
  let notificationsService: { create: jest.Mock };

  beforeEach(async () => {
    prisma = {
      task: { create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
      customer: { findFirst: jest.fn() },
      membership: { findUnique: jest.fn() },
    };
    auditService = { log: jest.fn() };
    activityService = { log: jest.fn() };
    notificationsService = { create: jest.fn() };
    prisma.membership.findUnique.mockResolvedValue({ id: 'm-1' });

    const module = await Test.createTestingModule({
      providers: [
        TasksService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: auditService },
        { provide: ActivityService, useValue: activityService },
        { provide: NotificationsService, useValue: notificationsService },
      ],
    }).compile();

    service = module.get(TasksService);
  });

  describe('create', () => {
    it('cria a tarefa escopada à organização, com actorType USER, e audita', async () => {
      const created = { id: 'task-1', organizationId: 'org-1', title: 'Ligar' };
      prisma.task.create.mockResolvedValue(created);

      const result = await service.create('org-1', { title: 'Ligar' }, 'user-1');

      expect(prisma.task.create).toHaveBeenCalledWith({
        data: { organizationId: 'org-1', title: 'Ligar', actorType: 'USER', actorId: 'user-1' },
      });
      expect(auditService.log).toHaveBeenCalledWith({
        actorType: 'USER',
        actorId: 'user-1',
        organizationId: 'org-1',
        action: 'task.created',
        resource: 'Task:task-1',
      });
      expect(result).toBe(created);
      expect(notificationsService.create).not.toHaveBeenCalled();
    });

    it('notifica o responsável quando a tarefa é criada já atribuída a outra pessoa', async () => {
      prisma.task.create.mockResolvedValue({
        id: 'task-1',
        title: 'Ligar',
        assigneeId: 'user-2',
      });

      await service.create('org-1', { title: 'Ligar', assigneeId: 'user-2' }, 'user-1');

      expect(notificationsService.create).toHaveBeenCalledWith({
        organizationId: 'org-1',
        userId: 'user-2',
        type: 'task.assigned',
        payload: { taskId: 'task-1', title: 'Ligar' },
      });
    });

    it('não notifica quando o criador se autoatribui a tarefa', async () => {
      prisma.task.create.mockResolvedValue({
        id: 'task-1',
        title: 'Ligar',
        assigneeId: 'user-1',
      });

      await service.create('org-1', { title: 'Ligar', assigneeId: 'user-1' }, 'user-1');

      expect(notificationsService.create).not.toHaveBeenCalled();
    });

    it('rejeita customerId de outra organização (ou inexistente)', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);

      await expect(
        service.create('org-1', { title: 'Ligar', customerId: 'cust-x' }, 'user-1'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.task.create).not.toHaveBeenCalled();
    });

    it('rejeita assigneeId que não é membro da organização', async () => {
      prisma.membership.findUnique.mockResolvedValue(null);

      await expect(
        service.create('org-1', { title: 'Ligar', assigneeId: 'user-x' }, 'user-1'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.task.create).not.toHaveBeenCalled();
    });
  });

  describe('findByIdOrThrow', () => {
    it('lança 404 quando a tarefa não existe ou é de outra org', async () => {
      prisma.task.findFirst.mockResolvedValue(null);

      await expect(service.findByIdOrThrow('org-1', 'missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('list', () => {
    it('lista tarefas da organização aplicando filtros informados', async () => {
      prisma.task.findMany.mockResolvedValue([]);

      await service.list('org-1', { status: 'OPEN', assigneeId: 'user-2' });

      expect(prisma.task.findMany).toHaveBeenCalledWith({
        where: { organizationId: 'org-1', status: 'OPEN', assigneeId: 'user-2' },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('update', () => {
    it('notifica o novo responsável ao reatribuir a tarefa para outra pessoa', async () => {
      prisma.task.findFirst.mockResolvedValue({
        id: 'task-1',
        organizationId: 'org-1',
        status: 'OPEN',
        customerId: null,
        assigneeId: 'user-2',
        title: 'Ligar',
      });
      prisma.task.update.mockResolvedValue({ id: 'task-1', assigneeId: 'user-3', title: 'Ligar' });

      await service.update('org-1', 'task-1', { assigneeId: 'user-3' }, 'user-1');

      expect(notificationsService.create).toHaveBeenCalledWith({
        organizationId: 'org-1',
        userId: 'user-3',
        type: 'task.assigned',
        payload: { taskId: 'task-1', title: 'Ligar' },
      });
    });

    it('não notifica de novo quando o responsável não muda', async () => {
      prisma.task.findFirst.mockResolvedValue({
        id: 'task-1',
        organizationId: 'org-1',
        status: 'OPEN',
        customerId: null,
        assigneeId: 'user-2',
      });
      prisma.task.update.mockResolvedValue({ id: 'task-1', assigneeId: 'user-2' });

      await service.update('org-1', 'task-1', { assigneeId: 'user-2', title: 'Só o título' }, 'user-1');

      expect(notificationsService.create).not.toHaveBeenCalled();
    });

    it('atualiza campos simples sem tocar em completedAt quando o status não muda', async () => {
      prisma.task.findFirst.mockResolvedValue({
        id: 'task-1',
        organizationId: 'org-1',
        status: 'OPEN',
        customerId: null,
      });
      prisma.task.update.mockResolvedValue({ id: 'task-1', title: 'Novo título' });

      await service.update('org-1', 'task-1', { title: 'Novo título' }, 'user-1');

      expect(prisma.task.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: { title: 'Novo título' },
      });
      expect(activityService.log).not.toHaveBeenCalled();
    });

    it('ao concluir (status → DONE), define completedAt e registra atividade no cliente vinculado', async () => {
      prisma.task.findFirst.mockResolvedValue({
        id: 'task-1',
        organizationId: 'org-1',
        status: 'OPEN',
        customerId: 'cust-1',
        title: 'Ligar',
      });
      prisma.task.update.mockResolvedValue({
        id: 'task-1',
        status: 'DONE',
        customerId: 'cust-1',
        title: 'Ligar',
      });

      await service.update('org-1', 'task-1', { status: 'DONE' }, 'user-1');

      expect(prisma.task.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: { status: 'DONE', completedAt: expect.any(Date) },
      });
      expect(activityService.log).toHaveBeenCalledWith({
        organizationId: 'org-1',
        customerId: 'cust-1',
        type: 'task.completed',
        actorType: 'USER',
        actorId: 'user-1',
        payload: { taskId: 'task-1', title: 'Ligar' },
      });
    });

    it('não registra atividade ao concluir uma tarefa sem cliente vinculado', async () => {
      prisma.task.findFirst.mockResolvedValue({
        id: 'task-1',
        organizationId: 'org-1',
        status: 'OPEN',
        customerId: null,
        title: 'Ligar',
      });
      prisma.task.update.mockResolvedValue({ id: 'task-1', status: 'DONE', customerId: null });

      await service.update('org-1', 'task-1', { status: 'DONE' }, 'user-1');

      expect(activityService.log).not.toHaveBeenCalled();
    });

    it('ao reabrir uma tarefa concluída, limpa completedAt', async () => {
      prisma.task.findFirst.mockResolvedValue({
        id: 'task-1',
        organizationId: 'org-1',
        status: 'DONE',
        customerId: null,
      });
      prisma.task.update.mockResolvedValue({ id: 'task-1', status: 'OPEN' });

      await service.update('org-1', 'task-1', { status: 'OPEN' }, 'user-1');

      expect(prisma.task.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: { status: 'OPEN', completedAt: null },
      });
    });

    it('rejeita mudar para um customerId de outra organização', async () => {
      prisma.task.findFirst.mockResolvedValue({
        id: 'task-1',
        organizationId: 'org-1',
        status: 'OPEN',
        customerId: null,
      });
      prisma.customer.findFirst.mockResolvedValue(null);

      await expect(
        service.update('org-1', 'task-1', { customerId: 'cust-x' }, 'user-1'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.task.update).not.toHaveBeenCalled();
    });
  });
});
