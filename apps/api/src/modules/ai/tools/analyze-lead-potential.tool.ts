import { ForbiddenException, Injectable } from '@nestjs/common';
import type { LeadEnrichment } from '@opsmind/database';
import { LeadAnalysisService } from '../../leads/lead-analysis.service';
import { WRITE_ROLES } from '../../../shared/constants/roles.constant';
import type { AiTool, AiToolContext } from './ai-tool.interface';

export interface AnalyzeLeadPotentialInput {
  leadId: string;
}

/**
 * Chama `LeadAnalysisService.analyzeLeadPotential` — uma chamada de IA
 * one-shot POR LEAD (nunca automática em massa, ver comentário de topo de
 * `LeadAnalysisService`) que consome o orçamento mensal de IA da
 * organização (`BudgetService`). Gated por `WRITE_ROLES`, mesmo racional de
 * `CreateTaskTool`: gastar budget é uma ação de escrita, não deveria estar
 * disponível para quem só tem permissão de leitura (`VIEWER`). O resultado
 * é gravado como `LeadEnrichment{type:'ai_analysis'}` — esta tool nunca muta
 * `Lead` diretamente.
 */
@Injectable()
export class AnalyzeLeadPotentialTool implements AiTool<AnalyzeLeadPotentialInput> {
  readonly name = 'analyze_lead_potential';
  readonly description =
    'Gera uma análise de IA sobre o potencial de um lead específico, explicando por que ele é (ou não) um bom alvo de prospecção. Consome orçamento de IA da organização.';
  readonly inputSchema = {
    type: 'object',
    properties: {
      leadId: { type: 'string' },
    },
    required: ['leadId'],
    additionalProperties: false,
  };

  constructor(private readonly leadAnalysisService: LeadAnalysisService) {}

  async execute(input: AnalyzeLeadPotentialInput, context: AiToolContext): Promise<LeadEnrichment> {
    if (!(WRITE_ROLES as readonly string[]).includes(context.role)) {
      throw new ForbiddenException(
        'Seu papel nesta organização não permite gerar análises de IA para leads — peça a um administrador.',
      );
    }

    return this.leadAnalysisService.analyzeLeadPotential(context.organizationId, input.leadId, context.userId);
  }
}
