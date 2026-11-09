import { Injectable } from '@nestjs/common';
import type { LeadSignal } from '@opsmind/database';
import { LeadSignalsService } from '../../leads/lead-signals.service';
import type { AiTool, AiToolContext } from './ai-tool.interface';

export interface ListLeadSignalsInput {
  leadId: string;
}

/**
 * Leitura pura — sem gate de `WRITE_ROLES` (mesmo padrão de `ListTasksTool`).
 * Devolve TODO o histórico (não só a última execução) incluindo evidência/
 * confiança/collector de cada sinal, nunca uma conclusão pronta — o modelo
 * deve citar a evidência, nunca afirmar "este lead precisa de X" sem
 * apontar qual sinal/URL sustenta isso (mesma instrução já reforçada no
 * prompt de `generate_outreach_message`).
 */
@Injectable()
export class ListLeadSignalsTool implements AiTool<ListLeadSignalsInput> {
  readonly name = 'list_lead_signals';
  readonly description =
    'Lista os sinais já detectados na investigação de site de um lead, com evidência, confiança e se é um fato observado (WEBSITE_PROFILER/MANUAL) ou uma inferência de IA (AI_ANALYSIS) — nunca trate um sinal como conclusão pronta, cite sempre a evidência.';
  readonly inputSchema = {
    type: 'object',
    properties: {
      leadId: { type: 'string' },
    },
    required: ['leadId'],
    additionalProperties: false,
  };

  constructor(private readonly leadSignalsService: LeadSignalsService) {}

  execute(input: ListLeadSignalsInput, context: AiToolContext): Promise<LeadSignal[]> {
    return this.leadSignalsService.listForLead(context.organizationId, input.leadId);
  }
}
