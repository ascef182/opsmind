import { ForbiddenException, Injectable } from '@nestjs/common';
import type { LeadScoreBreakdown } from '@opsmind/shared-types';
import { LeadsService } from '../../leads/leads.service';
import { WRITE_ROLES } from '../../../shared/constants/roles.constant';
import type { AiTool, AiToolContext } from './ai-tool.interface';

export interface ScoreLeadInput {
  leadId: string;
}

/**
 * Gated por `WRITE_ROLES` — `LeadsService.score()` NÃO é uma leitura pura:
 * grava `score`/`scoreBreakdown`/`suggestedOfferingId` incondicionalmente,
 * pode alterar `Lead.status` entre QUALIFIED/DISQUALIFIED (quando o lead
 * ainda está em status pré-qualificação) e grava uma entrada de `AuditLog`
 * atribuída ao usuário que chamou. A rota REST equivalente,
 * `POST .../leads/:leadId/score`, já é `@Roles(...WRITE_ROLES)` — esta tool
 * precisa do mesmo gate para não abrir pra um `VIEWER`, via chat, um caminho
 * de escrita que a rota REST nega a esse mesmo papel (a analogia original
 * com `ListInactiveCustomersTool`, que chama uma query pura sem nenhuma
 * escrita, não se sustentava para o comportamento real deste método).
 */
@Injectable()
export class ScoreLeadTool implements AiTool<ScoreLeadInput> {
  readonly name = 'score_lead';
  readonly description =
    'Recalcula a pontuação de qualificação de um lead (cálculo determinístico, não usa IA) e retorna o detalhamento do score. Pode disparar automaticamente investigação de site ou rascunho de outreach quando o lead qualifica.';
  readonly inputSchema = {
    type: 'object',
    properties: {
      leadId: { type: 'string' },
    },
    required: ['leadId'],
    additionalProperties: false,
  };

  constructor(private readonly leadsService: LeadsService) {}

  async execute(input: ScoreLeadInput, context: AiToolContext): Promise<LeadScoreBreakdown | null> {
    if (!(WRITE_ROLES as readonly string[]).includes(context.role)) {
      throw new ForbiddenException(
        'Seu papel nesta organização não permite recalcular a pontuação de leads — peça a um administrador.',
      );
    }

    const lead = await this.leadsService.score(context.organizationId, input.leadId, context.userId);
    return lead.scoreBreakdown as unknown as LeadScoreBreakdown | null;
  }
}
