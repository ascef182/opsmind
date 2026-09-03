import { Injectable } from '@nestjs/common';
import { LeadsService } from '../../leads/leads.service';
import type { AiTool, AiToolContext } from './ai-tool.interface';

export interface ScoreLeadInput {
  leadId: string;
}

/**
 * Sem gate de role — mesma justificativa de `ListInactiveCustomersTool`:
 * `LeadsService.score` recalcula `score`/`scoreBreakdown` por uma fórmula
 * determinística (`scoreLead()`, `@opsmind/shared-types`), não uma decisão
 * de negócio nova nem uma chamada de IA que consome budget. Rodar o cálculo
 * de novo não muda nada que um `VIEWER` não pudesse já ver lendo o lead
 * (`GET .../leads/:id`) — só recalcula em cima de dados já visíveis para
 * qualquer papel, então não há necessidade de restringir por `WRITE_ROLES`.
 */
@Injectable()
export class ScoreLeadTool implements AiTool<ScoreLeadInput> {
  readonly name = 'score_lead';
  readonly description =
    'Recalcula a pontuação de qualificação de um lead (cálculo determinístico, não usa IA) e retorna o detalhamento do score.';
  readonly inputSchema = {
    type: 'object',
    properties: {
      leadId: { type: 'string' },
    },
    required: ['leadId'],
    additionalProperties: false,
  };

  constructor(private readonly leadsService: LeadsService) {}

  async execute(input: ScoreLeadInput, context: AiToolContext): Promise<unknown> {
    const lead = await this.leadsService.score(context.organizationId, input.leadId, context.userId);
    return lead.scoreBreakdown;
  }
}
