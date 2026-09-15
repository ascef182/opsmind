import { Injectable, NotFoundException } from '@nestjs/common';
import type { Meeting } from '@opsmind/database';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateMeetingDto } from './dto/create-meeting.dto';
import { UpdateMeetingDto } from './dto/update-meeting.dto';

const DEFAULT_DURATION_MINUTES = 30;

/**
 * Agenda/reuniões (plano pensando-como-empresa-com-agile-beaver.md) — sem
 * repository layer, mesmo padrão de `DealsService`/`CustomersService`.
 */
@Injectable()
export class MeetingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(
    organizationId: string,
    dealId: string,
    dto: CreateMeetingDto,
    actorUserId: string,
  ): Promise<Meeting> {
    await this.assertDealInOrg(organizationId, dealId);

    const meeting = await this.prisma.meeting.create({
      data: {
        organizationId,
        dealId,
        title: dto.title,
        scheduledAt: dto.scheduledAt,
        durationMinutes: dto.durationMinutes ?? DEFAULT_DURATION_MINUTES,
        location: dto.location,
        notes: dto.notes,
        actorType: 'USER',
        actorId: actorUserId,
      },
    });

    await this.auditService.log({
      actorType: 'USER',
      actorId: actorUserId,
      organizationId,
      action: 'meeting.created',
      resource: `Meeting:${meeting.id}`,
    });

    return meeting;
  }

  async findByIdOrThrow(organizationId: string, id: string): Promise<Meeting> {
    const meeting = await this.prisma.meeting.findFirst({ where: { id, organizationId } });
    if (!meeting) {
      throw new NotFoundException('Reunião não encontrada');
    }
    return meeting;
  }

  list(organizationId: string, dealId: string): Promise<Meeting[]> {
    return this.prisma.meeting.findMany({
      where: { organizationId, dealId },
      orderBy: { scheduledAt: 'asc' },
    });
  }

  async update(
    organizationId: string,
    id: string,
    dto: UpdateMeetingDto,
    actorUserId: string,
  ): Promise<Meeting> {
    const existing = await this.findByIdOrThrow(organizationId, id);

    // Novo horário merece novo lembrete quando vencer — mesmo racional de
    // `TasksService.update` limpando `dueDateNotifiedAt`.
    const scheduledAtChanged =
      dto.scheduledAt !== undefined && dto.scheduledAt.getTime() !== existing.scheduledAt.getTime();

    const updated = await this.prisma.meeting.update({
      where: { id },
      data: {
        ...dto,
        ...(scheduledAtChanged ? { reminderNotifiedAt: null } : {}),
      },
    });

    await this.auditService.log({
      actorType: 'USER',
      actorId: actorUserId,
      organizationId,
      action: 'meeting.updated',
      resource: `Meeting:${id}`,
      metadata: { ...dto } as never,
    });

    return updated;
  }

  async cancel(organizationId: string, id: string, actorUserId: string): Promise<Meeting> {
    await this.findByIdOrThrow(organizationId, id);

    const updated = await this.prisma.meeting.update({
      where: { id },
      data: { canceledAt: new Date() },
    });

    await this.auditService.log({
      actorType: 'USER',
      actorId: actorUserId,
      organizationId,
      action: 'meeting.canceled',
      resource: `Meeting:${id}`,
    });

    return updated;
  }

  private async assertDealInOrg(organizationId: string, dealId: string): Promise<void> {
    const deal = await this.prisma.deal.findFirst({
      where: { id: dealId, organizationId, deletedAt: null },
    });
    if (!deal) {
      throw new NotFoundException('Negócio vinculado não encontrado');
    }
  }
}
