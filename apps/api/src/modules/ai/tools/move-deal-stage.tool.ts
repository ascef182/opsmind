import { ForbiddenException, Injectable } from '@nestjs/common';
import type { Deal, DealStage } from '@opsmind/database';
import { DealsService } from '../../deals/deals.service';
import { WRITE_ROLES } from '../../../shared/constants/roles.constant';
import type { AiTool, AiToolContext } from './ai-tool.interface';

export interface MoveDealStageInput {
  dealId: string;
  stage: DealStage;
  lostReason?: string;
}

/**
 * Gated por `WRITE_ROLES`, mesmo racional de `score-lead.tool.ts`: não é
 * leitura pura, embora o nome pudesse sugerir uma simples consulta — escreve
 * `stage`/`actualCloseDate`/`lostReason` e uma entrada de `AuditLog`
 * atribuída ao usuário que invocou.
 */
@Injectable()
export class MoveDealStageTool implements AiTool<MoveDealStageInput> {
  readonly name = 'move_deal_stage';
  readonly description =
    'Move um negócio para outro estágio do pipeline de vendas (qualificação, proposta, negociação, contrato enviado, ganho ou perdido). Exige lostReason ao mover para perdido.';
  readonly inputSchema = {
    type: 'object',
    properties: {
      dealId: { type: 'string', format: 'uuid' },
      stage: {
        type: 'string',
        enum: ['QUALIFICATION', 'PROPOSAL', 'NEGOTIATION', 'CONTRACT_SENT', 'WON', 'LOST'],
      },
      lostReason: { type: 'string', description: 'Obrigatório quando stage = LOST.' },
    },
    required: ['dealId', 'stage'],
    additionalProperties: false,
  };

  constructor(private readonly dealsService: DealsService) {}

  async execute(input: MoveDealStageInput, context: AiToolContext): Promise<Deal> {
    if (!(WRITE_ROLES as readonly string[]).includes(context.role)) {
      throw new ForbiddenException(
        'Seu papel nesta organização não permite mudar o estágio de negócios — peça a um administrador.',
      );
    }

    return this.dealsService.moveStage(
      context.organizationId,
      input.dealId,
      { stage: input.stage, lostReason: input.lostReason },
      context.userId,
    );
  }
}
