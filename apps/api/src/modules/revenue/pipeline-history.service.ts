import { Injectable } from '@nestjs/common';
import { recordStageTransition, type AuditActorType, type DealStage } from '@opsmind/database';
import { dealStageToPipelineStage, leadStatusToPipelineStage } from '@opsmind/shared-types';
import { PrismaService } from '../../infrastructure/database/prisma.service';

export interface PipelineActor {
  type: AuditActorType;
  id?: string | null;
}

/**
 * Único ponto da API que grava `PipelineStageTransition`. Chamada explícita
 * em cada service que muda `Lead.status`/`Deal.stage` (mesma decisão de
 * `AuditService`: sem interceptor/trigger, o chamador sabe quem é o ator).
 * Roda na transação da request via proxy do `PrismaService`, então some junto
 * se a mudança de status for revertida.
 */
@Injectable()
export class PipelineHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  leadStatusChanged(
    organizationId: string,
    leadId: string,
    fromStatus: string | null,
    toStatus: string,
    actor: PipelineActor,
  ): Promise<void> {
    return recordStageTransition(this.prisma, {
      organizationId,
      leadId,
      fromStage: fromStatus ? leadStatusToPipelineStage(fromStatus) : null,
      toStage: leadStatusToPipelineStage(toStatus),
      actorType: actor.type,
      actorId: actor.id,
    });
  }

  dealStageChanged(
    organizationId: string,
    deal: { id: string; originLeadId: string | null },
    fromStage: DealStage | null,
    toStage: DealStage,
    actor: PipelineActor,
  ): Promise<void> {
    return recordStageTransition(this.prisma, {
      organizationId,
      dealId: deal.id,
      leadId: deal.originLeadId,
      fromStage: fromStage ? dealStageToPipelineStage(fromStage) : null,
      toStage: dealStageToPipelineStage(toStage),
      actorType: actor.type,
      actorId: actor.id,
    });
  }
}
