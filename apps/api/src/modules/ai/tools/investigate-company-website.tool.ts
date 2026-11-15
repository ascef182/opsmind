import { ForbiddenException, Injectable } from '@nestjs/common';
import { LeadSignalsService } from '../../leads/lead-signals.service';
import { WRITE_ROLES } from '../../../shared/constants/roles.constant';
import type { AiTool, AiToolContext } from './ai-tool.interface';

export interface InvestigateCompanyWebsiteInput {
  leadId: string;
}

export interface InvestigateCompanyWebsiteOutput {
  status: 'QUEUED';
}

/**
 * Enfileira o job `website-profile` (`apps/worker/src/website-profiler-processor.ts`)
 * via `LeadSignalsService.requestInvestigation` — mesmo padrão fire-and-forget
 * de `FindLeadsTool`: NUNCA espera o job terminar (o profiler faz
 * requisições de rede reais, protegidas contra SSRF — ver
 * `ssrf-safe-fetch.ts` — mas ainda assim de duração variável). O modelo
 * deve informar o usuário que a investigação foi disparada e, se quiser,
 * checar `list_lead_signals` depois.
 *
 * Gated por `WRITE_ROLES`: aloca capacidade do worker e grava
 * `LeadSignal`/`LeadEnrichment`/`AuditLog` ao terminar — mesmo racional de
 * `FindLeadsTool`/`ScoreLeadTool`. Nunca chama nenhum gateway pago
 * diretamente (o profiler usa só `ssrfSafeFetch`, sem Apify/Explorium/
 * Camoufox) e nunca aprova/envia nada.
 */
@Injectable()
export class InvestigateCompanyWebsiteTool implements AiTool<InvestigateCompanyWebsiteInput> {
  readonly name = 'investigate_company_website';
  readonly description =
    'Dispara uma investigação assíncrona do site público de um lead (sem navegador, sem IA) e grava os sinais encontrados. Não espera o resultado — use list_lead_signals depois para ver o que foi encontrado.';
  readonly inputSchema = {
    type: 'object',
    properties: {
      leadId: { type: 'string' },
    },
    required: ['leadId'],
    additionalProperties: false,
  };

  constructor(private readonly leadSignalsService: LeadSignalsService) {}

  async execute(
    input: InvestigateCompanyWebsiteInput,
    context: AiToolContext,
  ): Promise<InvestigateCompanyWebsiteOutput> {
    if (!(WRITE_ROLES as readonly string[]).includes(context.role)) {
      throw new ForbiddenException(
        'Seu papel nesta organização não permite disparar investigação de site — peça a um administrador.',
      );
    }

    await this.leadSignalsService.requestInvestigation(context.organizationId, input.leadId, context.userId);
    return { status: 'QUEUED' };
  }
}
