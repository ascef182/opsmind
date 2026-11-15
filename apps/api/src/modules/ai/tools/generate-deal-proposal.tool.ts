// Mesma regra dura de `generate-outreach-message.tool.ts`: esta tool só
// GERA um rascunho de proposta (`DealProposalService.generate`, grava
// `Deal.proposalDraft`) — nunca move estágio, nunca "envia" nada. Enviar a
// proposta ao cliente continua sendo uma ação manual do vendedor fora do
// OpsMind (mesmo racional de `DealStage.CONTRACT_SENT` ser uma flag manual,
// ver deals.service.ts).
import { ForbiddenException, Injectable } from '@nestjs/common';
import type { Deal } from '@opsmind/database';
import { DealProposalService } from '../../deals/deal-proposal.service';
import { WRITE_ROLES } from '../../../shared/constants/roles.constant';
import type { AiTool, AiToolContext } from './ai-tool.interface';

export interface GenerateDealProposalInput {
  dealId: string;
}

/**
 * Gera uma minuta de proposta/contrato para um negócio existente
 * (`DealProposalService.generate`). Gated por `WRITE_ROLES`: chama a IA
 * (consome budget) e grava em `Deal.proposalDraft` — mesmo racional de
 * `GenerateOutreachMessageTool`.
 */
@Injectable()
export class GenerateDealProposalTool implements AiTool<GenerateDealProposalInput> {
  readonly name = 'generate_deal_proposal';
  readonly description =
    'Gera uma minuta de proposta/contrato comercial para um negócio (deal), com base no cliente/valor/título do negócio. Rascunho editável — o envio ao cliente é sempre manual, fora desta ferramenta.';
  readonly inputSchema = {
    type: 'object',
    properties: {
      dealId: { type: 'string', format: 'uuid' },
    },
    required: ['dealId'],
    additionalProperties: false,
  };

  constructor(private readonly dealProposalService: DealProposalService) {}

  async execute(input: GenerateDealProposalInput, context: AiToolContext): Promise<Deal> {
    if (!(WRITE_ROLES as readonly string[]).includes(context.role)) {
      throw new ForbiddenException(
        'Seu papel nesta organização não permite gerar propostas — peça a um administrador.',
      );
    }

    return this.dealProposalService.generate(context.organizationId, input.dealId, context.userId);
  }
}
