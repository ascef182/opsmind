import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Automation, AutomationRun, AutomationTrigger, Prisma } from '@opsmind/database';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AutomationQueueService } from '../../infrastructure/queue/automation-queue.service';

export interface CustomerInactiveConditions {
  inactiveForDays?: number;
}

export interface CustomerInactiveActions {
  createTask?: boolean;
  notify?: boolean;
}

export interface CreateAutomationInput {
  name: string;
  trigger: AutomationTrigger;
  conditions?: CustomerInactiveConditions;
  actions: CustomerInactiveActions;
  enabled?: boolean;
}

/**
 * Sem repository layer (Decisão #12 do blueprint da Fase 1, mantida aqui) —
 * chama `PrismaService` diretamente.
 */
@Injectable()
export class AutomationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: AutomationQueueService,
    private readonly auditService: AuditService,
  ) {}

  async create(organizationId: string, actorUserId: string, dto: CreateAutomationInput): Promise<Automation> {
    const automation = await this.prisma.automation.create({
      data: {
        organizationId,
        name: dto.name,
        trigger: dto.trigger,
        conditions: (dto.conditions ?? {}) as Prisma.InputJsonValue,
        actions: dto.actions as Prisma.InputJsonValue,
        enabled: dto.enabled ?? true,
      },
    });

    await this.auditService.log({
      actorType: 'USER',
      actorId: actorUserId,
      organizationId,
      action: 'automation.created',
      resource: `Automation:${automation.id}`,
    });

    return automation;
  }

  list(organizationId: string): Promise<Automation[]> {
    return this.prisma.automation.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByIdOrThrow(organizationId: string, automationId: string): Promise<Automation> {
    const automation = await this.prisma.automation.findFirst({
      where: { id: automationId, organizationId },
    });
    if (!automation) {
      throw new NotFoundException('Automação não encontrada');
    }
    return automation;
  }

  listRuns(organizationId: string, automationId: string): Promise<AutomationRun[]> {
    return this.prisma.automationRun.findMany({
      where: { organizationId, automationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * "Execução manual/teste" (PRD §11) — acha quem qualifica pra essa
   * automação AGORA e enfileira uma execução por cliente, actorType USER
   * (diferente do scan periódico do worker, que usa SYSTEM). Duplica a
   * mesma regra de scanCustomerInactiveAutomations (apps/worker) — ver
   * comentário lá sobre por quê (processos separados, sem DI compartilhada).
   */
  async runNow(
    organizationId: string,
    actorUserId: string,
    automationId: string,
  ): Promise<{ enqueued: number }> {
    const automation = await this.findByIdOrThrow(organizationId, automationId);
    if (!automation.enabled) {
      throw new BadRequestException('Automação está desabilitada');
    }

    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
    });
    const conditions = automation.conditions as CustomerInactiveConditions;
    const inactiveForDays = conditions.inactiveForDays ?? organization.inactiveAfterDays;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - inactiveForDays);

    const inactiveCustomers = await this.prisma.customer.findMany({
      where: { organizationId, deletedAt: null, lastActivityAt: { lt: cutoff } },
    });

    for (const customer of inactiveCustomers) {
      await this.queueService.enqueue({
        organizationId,
        automationId: automation.id,
        customerId: customer.id,
        actorType: 'USER',
        actorId: actorUserId,
      });
    }

    return { enqueued: inactiveCustomers.length };
  }
}
