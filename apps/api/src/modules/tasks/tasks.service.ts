import { Injectable, NotFoundException } from '@nestjs/common';
import type { Task, TaskStatus } from '@opsmind/database';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ActivityService } from '../activity/activity.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';

export interface ListTasksFilter {
  status?: TaskStatus;
  assigneeId?: string;
  customerId?: string;
}

/**
 * Sem repository layer (Decisão #12 do blueprint da Fase 1, mantida aqui) —
 * chama `PrismaService` diretamente.
 */
@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly activityService: ActivityService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async create(organizationId: string, dto: CreateTaskDto, actorUserId: string): Promise<Task> {
    if (dto.customerId) {
      await this.assertCustomerInOrg(organizationId, dto.customerId);
    }
    if (dto.assigneeId) {
      await this.assertAssigneeInOrg(organizationId, dto.assigneeId);
    }

    const task = await this.prisma.task.create({
      data: { organizationId, ...dto, actorType: 'USER', actorId: actorUserId },
    });

    await this.auditService.log({
      actorType: 'USER',
      actorId: actorUserId,
      organizationId,
      action: 'task.created',
      resource: `Task:${task.id}`,
    });

    if (task.assigneeId && task.assigneeId !== actorUserId) {
      await this.notifyAssignee(organizationId, task);
    }

    return task;
  }

  async findByIdOrThrow(organizationId: string, id: string): Promise<Task> {
    const task = await this.prisma.task.findFirst({ where: { id, organizationId } });
    if (!task) {
      throw new NotFoundException('Tarefa não encontrada');
    }
    return task;
  }

  list(organizationId: string, filter: ListTasksFilter): Promise<Task[]> {
    return this.prisma.task.findMany({
      where: { organizationId, ...filter },
      orderBy: { createdAt: 'desc' },
    });
  }

  async update(
    organizationId: string,
    id: string,
    dto: UpdateTaskDto,
    actorUserId: string,
  ): Promise<Task> {
    const existing = await this.findByIdOrThrow(organizationId, id);

    if (dto.customerId) {
      await this.assertCustomerInOrg(organizationId, dto.customerId);
    }
    if (dto.assigneeId) {
      await this.assertAssigneeInOrg(organizationId, dto.assigneeId);
    }

    const completingNow = dto.status === 'DONE' && existing.status !== 'DONE';
    const reopening = dto.status !== undefined && dto.status !== 'DONE' && existing.status === 'DONE';

    const data = {
      ...dto,
      ...(completingNow ? { completedAt: new Date() } : {}),
      ...(reopening ? { completedAt: null } : {}),
    };

    const updated = await this.prisma.task.update({ where: { id }, data });

    await this.auditService.log({
      actorType: 'USER',
      actorId: actorUserId,
      organizationId,
      action: 'task.updated',
      resource: `Task:${id}`,
      metadata: { ...dto },
    });

    if (completingNow && updated.customerId) {
      await this.activityService.log({
        organizationId,
        customerId: updated.customerId,
        type: 'task.completed',
        actorType: 'USER',
        actorId: actorUserId,
        payload: { taskId: updated.id, title: updated.title },
      });
    }

    const reassigned = dto.assigneeId !== undefined && dto.assigneeId !== existing.assigneeId;
    if (reassigned && updated.assigneeId && updated.assigneeId !== actorUserId) {
      await this.notifyAssignee(organizationId, updated);
    }

    return updated;
  }

  private notifyAssignee(organizationId: string, task: Task): Promise<unknown> {
    return this.notificationsService.create({
      organizationId,
      userId: task.assigneeId!,
      type: 'task.assigned',
      payload: { taskId: task.id, title: task.title },
    });
  }

  private async assertCustomerInOrg(organizationId: string, customerId: string): Promise<void> {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, organizationId, deletedAt: null },
    });
    if (!customer) {
      throw new NotFoundException('Cliente vinculado não encontrado');
    }
  }

  private async assertAssigneeInOrg(organizationId: string, assigneeId: string): Promise<void> {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_organizationId: { userId: assigneeId, organizationId } },
    });
    if (!membership) {
      throw new NotFoundException('Responsável não é membro desta organização');
    }
  }
}
