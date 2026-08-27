import { Injectable, NotFoundException } from '@nestjs/common';
import type { ActivityLog, Customer, CustomerStatus } from '@opsmind/database';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ActivityService } from '../activity/activity.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

export interface ListCustomersFilter {
  status?: CustomerStatus;
  tag?: string;
  search?: string;
}

/**
 * Sem repository layer (Decisão #12 do blueprint da Fase 1, mantida aqui) —
 * chama `PrismaService` diretamente.
 */
@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly activityService: ActivityService,
  ) {}

  async create(organizationId: string, dto: CreateCustomerDto, actorUserId: string): Promise<Customer> {
    const customer = await this.prisma.customer.create({
      data: { organizationId, ...dto },
    });

    await this.auditService.log({
      actorType: 'USER',
      actorId: actorUserId,
      organizationId,
      action: 'customer.created',
      resource: `Customer:${customer.id}`,
    });

    return customer;
  }

  async findByIdOrThrow(organizationId: string, id: string): Promise<Customer> {
    const customer = await this.prisma.customer.findFirst({
      where: { id, organizationId, deletedAt: null },
    });
    if (!customer) {
      throw new NotFoundException('Cliente não encontrado');
    }
    return customer;
  }

  list(organizationId: string, filter: ListCustomersFilter): Promise<Customer[]> {
    return this.prisma.customer.findMany({
      where: {
        organizationId,
        deletedAt: null,
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.tag ? { tags: { has: filter.tag } } : {}),
        ...(filter.search ? { name: { contains: filter.search, mode: 'insensitive' } } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Regra de negócio do PRD §8: cliente sem NENHUMA atividade há mais de
   * `organization.inactiveAfterDays` dias — mesmo cálculo de
   * `DashboardService.getOverview` ("inactiveByRule"), mas devolvendo os
   * clientes de verdade, não só a contagem. Existe para a tool de IA
   * `list_inactive_customers` responder ao cenário do critério de aceitação
   * da Fase 3: "quais clientes sem contato há 14 dias?".
   */
  async listInactive(organizationId: string): Promise<Customer[]> {
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
    });

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - organization.inactiveAfterDays);

    return this.prisma.customer.findMany({
      where: { organizationId, deletedAt: null, lastActivityAt: { lt: cutoff } },
      orderBy: { lastActivityAt: 'asc' },
    });
  }

  async update(
    organizationId: string,
    id: string,
    dto: UpdateCustomerDto,
    actorUserId: string,
  ): Promise<Customer> {
    await this.findByIdOrThrow(organizationId, id);

    const updated = await this.prisma.customer.update({ where: { id }, data: dto });

    await this.auditService.log({
      actorType: 'USER',
      actorId: actorUserId,
      organizationId,
      action: 'customer.updated',
      resource: `Customer:${id}`,
      metadata: { ...dto },
    });

    return updated;
  }

  async softDelete(organizationId: string, id: string, actorUserId: string): Promise<void> {
    await this.findByIdOrThrow(organizationId, id);

    await this.prisma.customer.update({ where: { id }, data: { deletedAt: new Date() } });

    await this.auditService.log({
      actorType: 'USER',
      actorId: actorUserId,
      organizationId,
      action: 'customer.deleted',
      resource: `Customer:${id}`,
    });
  }

  async addNote(
    organizationId: string,
    customerId: string,
    note: string,
    actorUserId: string,
  ): Promise<ActivityLog> {
    await this.findByIdOrThrow(organizationId, customerId);

    return this.activityService.log({
      organizationId,
      customerId,
      type: 'note.added',
      actorType: 'USER',
      actorId: actorUserId,
      payload: { note },
    });
  }
}
