import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Deal, DealStage } from '@opsmind/database';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ActivityService } from '../activity/activity.service';
import { CreateDealDto } from './dto/create-deal.dto';
import { UpdateDealDto } from './dto/update-deal.dto';
import { MoveDealStageDto } from './dto/move-deal-stage.dto';
import { ListDealsQueryDto } from './dto/list-deals-query.dto';

export interface ListDealsFilter {
  stage?: ListDealsQueryDto['stage'];
  customerId?: string;
  ownerUserId?: string;
  search?: string;
  // Usado por `GetCustomerTool` (extensão de `get_customer`) para trazer só
  // negócios em aberto de um cliente, sem precisar de um segundo filtro
  // "stage IN (...)" no chamador.
  excludeClosed?: boolean;
}

// Mapa de transições válidas de `Deal.stage` — diferente de `Lead.status`
// (majoritariamente livre), `stage` é o coração desta feature: win rate e
// ciclo de venda dependem de integridade de estágio, então cada par
// origem->destino é explícito em vez de aceitar qualquer valor.
const ALLOWED_TRANSITIONS: Record<DealStage, DealStage[]> = {
  QUALIFICATION: ['PROPOSAL', 'NEGOTIATION', 'WON', 'LOST'],
  PROPOSAL: ['QUALIFICATION', 'NEGOTIATION', 'CONTRACT_SENT', 'WON', 'LOST'],
  NEGOTIATION: ['PROPOSAL', 'CONTRACT_SENT', 'WON', 'LOST'],
  CONTRACT_SENT: ['NEGOTIATION', 'WON', 'LOST'],
  // Terminal — reverter um deal ganho é correção de dado, não fluxo de
  // produto (sem endpoint pra isso).
  WON: [],
  // Deliberado: um deal perdido pode reabrir se o prospect voltar à mesa.
  LOST: ['QUALIFICATION'],
};

const CLOSED_STAGES: DealStage[] = ['WON', 'LOST'];

/**
 * Sem repository layer — chama `PrismaService` diretamente, mesmo padrão de
 * `CustomersService`/`LeadsService`/`TasksService`.
 */
@Injectable()
export class DealsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly activityService: ActivityService,
  ) {}

  // `internal.originLeadId`: nunca vem de DTO/tool pública — só
  // `LeadsService.convertToCustomer()` passa isso, na ponte "achar -> fechar"
  // (ver comentário lá). Fora desse caminho, um Deal nasce sem Lead de
  // origem.
  async create(
    organizationId: string,
    dto: CreateDealDto,
    actorUserId: string,
    internal?: { originLeadId?: string },
  ): Promise<Deal> {
    await this.assertCustomerInOrg(organizationId, dto.customerId);

    const deal = await this.prisma.deal.create({
      data: {
        organizationId,
        actorType: 'USER',
        actorId: actorUserId,
        ...dto,
        ...(internal?.originLeadId ? { originLeadId: internal.originLeadId } : {}),
      },
    });

    await this.auditService.log({
      actorType: 'USER',
      actorId: actorUserId,
      organizationId,
      action: 'deal.created',
      resource: `Deal:${deal.id}`,
    });

    return deal;
  }

  async findByIdOrThrow(organizationId: string, id: string): Promise<Deal> {
    const deal = await this.prisma.deal.findFirst({
      where: { id, organizationId, deletedAt: null },
    });
    if (!deal) {
      throw new NotFoundException('Negócio não encontrado');
    }
    return deal;
  }

  list(organizationId: string, filter: ListDealsFilter): Promise<Deal[]> {
    return this.prisma.deal.findMany({
      where: {
        organizationId,
        deletedAt: null,
        ...(filter.stage ? { stage: filter.stage } : {}),
        ...(filter.customerId ? { customerId: filter.customerId } : {}),
        ...(filter.ownerUserId ? { ownerUserId: filter.ownerUserId } : {}),
        ...(filter.excludeClosed ? { stage: { notIn: CLOSED_STAGES } } : {}),
        ...(filter.search
          ? { title: { contains: filter.search, mode: 'insensitive' as const } }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async update(
    organizationId: string,
    id: string,
    dto: UpdateDealDto,
    actorUserId: string,
  ): Promise<Deal> {
    await this.findByIdOrThrow(organizationId, id);

    const updated = await this.prisma.deal.update({
      where: { id },
      data: { ...dto },
    });

    await this.auditService.log({
      actorType: 'USER',
      actorId: actorUserId,
      organizationId,
      action: 'deal.updated',
      resource: `Deal:${id}`,
      metadata: { ...dto } as never,
    });

    return updated;
  }

  /**
   * `POST .../deals/:dealId/move-stage` — única forma de mudar `Deal.stage`.
   * Escrita atômica compare-and-swap (mesmo padrão de
   * `OutreachService.applyTransition`, `apps/api/src/modules/leads/outreach.service.ts`):
   * o `updateMany` só afeta a linha se ela ainda estiver no estágio lido,
   * fechando a corrida entre dois usuários movendo o mesmo deal ao mesmo
   * tempo.
   */
  async moveStage(
    organizationId: string,
    id: string,
    dto: MoveDealStageDto,
    actorUserId: string,
  ): Promise<Deal> {
    const deal = await this.findByIdOrThrow(organizationId, id);

    if (!(ALLOWED_TRANSITIONS[deal.stage] ?? []).includes(dto.stage)) {
      throw new BadRequestException(
        `Não é possível mover um negócio de ${deal.stage} para ${dto.stage}.`,
      );
    }
    if (dto.stage === 'LOST' && !dto.lostReason) {
      throw new BadRequestException('Informe o motivo da perda para mover o negócio para LOST.');
    }

    const closingNow = CLOSED_STAGES.includes(dto.stage);
    const reopening = dto.stage === 'QUALIFICATION' && deal.stage === 'LOST';

    const { count } = await this.prisma.deal.updateMany({
      where: { id, organizationId, stage: deal.stage, deletedAt: null },
      data: {
        stage: dto.stage,
        ...(dto.stage === 'LOST' ? { lostReason: dto.lostReason } : {}),
        ...(reopening ? { lostReason: null } : {}),
        ...(closingNow ? { actualCloseDate: new Date() } : {}),
      },
    });

    if (count === 0) {
      const current = await this.prisma.deal.findFirst({ where: { id, organizationId } });
      throw new BadRequestException(
        `Não é possível mover para ${dto.stage}: o negócio já não está mais em ${deal.stage} (estágio atual: ${current?.stage ?? 'desconhecido'}).`,
      );
    }

    const updated = await this.findByIdOrThrow(organizationId, id);

    if (closingNow) {
      // Já atualiza `Customer.lastActivityAt` na mesma chamada — um deal
      // fechado conta como atividade recente pra detecção de inatividade
      // (ver comentário de `ActivityService.log`).
      await this.activityService.log({
        organizationId,
        customerId: updated.customerId,
        type: dto.stage === 'WON' ? 'deal.won' : 'deal.lost',
        actorType: 'USER',
        actorId: actorUserId,
        payload: {
          dealId: updated.id,
          value: updated.value.toString(),
          currency: updated.currency,
          ...(dto.stage === 'LOST' ? { lostReason: dto.lostReason } : {}),
        },
      });
    }

    await this.auditService.log({
      actorType: 'USER',
      actorId: actorUserId,
      organizationId,
      action: 'deal.stage_changed',
      resource: `Deal:${id}`,
      metadata: { from: deal.stage, to: dto.stage },
    });

    return updated;
  }

  async remove(organizationId: string, id: string, actorUserId: string): Promise<void> {
    await this.findByIdOrThrow(organizationId, id);

    await this.prisma.deal.update({ where: { id }, data: { deletedAt: new Date() } });

    await this.auditService.log({
      actorType: 'USER',
      actorId: actorUserId,
      organizationId,
      action: 'deal.deleted',
      resource: `Deal:${id}`,
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
}
