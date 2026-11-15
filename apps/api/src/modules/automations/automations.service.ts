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

export interface DealStaleConditions {
  thresholdHoursOverride?: number;
}

export interface DealStaleActions {
  createTask?: boolean;
  notify?: boolean;
}

export interface DealSilentForConditions {
  silentForDays?: number;
}

export interface DealSilentForActions {
  createTask?: boolean;
  notify?: boolean;
}

export interface CreateAutomationInput {
  name: string;
  trigger: AutomationTrigger;
  conditions?: CustomerInactiveConditions | DealStaleConditions | DealSilentForConditions;
  actions: CustomerInactiveActions | DealStaleActions | DealSilentForActions;
  enabled?: boolean;
}

// `trigger` fica de fora deliberadamente: mudar o tipo de uma automação sob o
// mesmo histórico de execução não é suportado.
export interface UpdateAutomationInput {
  name?: string;
  conditions?: CustomerInactiveConditions | DealStaleConditions | DealSilentForConditions;
  actions?: CustomerInactiveActions | DealStaleActions | DealSilentForActions;
  enabled?: boolean;
}

const CONDITION_NUMERIC_FIELD: Record<AutomationTrigger, string> = {
  CUSTOMER_INACTIVE: 'inactiveForDays',
  DEAL_STAGE_STALE: 'thresholdHoursOverride',
  DEAL_SILENT_FOR: 'silentForDays',
};

// Limite superior por trigger, não um valor único: os dois campos em dias
// usam 3650 (10 anos); o de DEAL_STAGE_STALE é em HORAS, então usa a mesma
// janela de 10 anos convertida (87600h) — sem isto, um valor absurdamente
// grande propagado pro `setDate`/`computeDealRisk` do scan (automation-scan.ts)
// produz `Invalid Date` ou sai do range de timestamp do Postgres.
const CONDITION_NUMERIC_FIELD_MAX: Record<AutomationTrigger, number> = {
  CUSTOMER_INACTIVE: 3650,
  DEAL_STAGE_STALE: 87_600,
  DEAL_SILENT_FOR: 3650,
};

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

  private assertValidConditionsRange(trigger: AutomationTrigger, conditions: object | undefined): void {
    const field = CONDITION_NUMERIC_FIELD[trigger];
    const value = (conditions as Record<string, unknown> | undefined)?.[field];
    if (value === undefined) return;

    const max = CONDITION_NUMERIC_FIELD_MAX[trigger];
    if (!Number.isInteger(value) || (value as number) <= 0 || (value as number) > max) {
      throw new BadRequestException(`${field} deve ser um inteiro positivo até ${max}`);
    }
  }

  async create(organizationId: string, actorUserId: string, dto: CreateAutomationInput): Promise<Automation> {
    this.assertValidConditionsRange(dto.trigger, dto.conditions);

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

  async update(
    organizationId: string,
    actorUserId: string,
    automationId: string,
    dto: UpdateAutomationInput,
  ): Promise<Automation> {
    const existing = await this.findByIdOrThrow(organizationId, automationId);
    this.assertValidConditionsRange(existing.trigger, dto.conditions);

    const automation = await this.prisma.automation.update({
      where: { id: automationId },
      data: dto as Prisma.AutomationUpdateInput,
    });

    await this.auditService.log({
      actorType: 'USER',
      actorId: actorUserId,
      organizationId,
      action: 'automation.updated',
      resource: `Automation:${automationId}`,
      metadata: { ...dto } as Prisma.InputJsonValue,
    });

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
    if (automation.trigger !== 'CUSTOMER_INACTIVE') {
      throw new BadRequestException('Execução manual só suporta automações de cliente inativo');
    }
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
