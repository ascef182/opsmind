import { Injectable } from '@nestjs/common';
import { LeadSignalsService, type SignalOfferingMapping } from '../../leads/lead-signals.service';
import type { AiTool, AiToolContext } from './ai-tool.interface';

export interface MapSignalToOfferingInput {
  leadId: string;
}

/**
 * Leitura pura e determinística — sem gate de `WRITE_ROLES`, sem chamada de
 * IA (`LeadSignalsService.mapToOfferings()` só agrupa e filtra, nunca
 * infere). Mostra POR QUE uma oferta é sugerida: cada item vem com a lista
 * de sinais confirmados + a evidência de cada um, nunca uma afirmação
 * isolada — regra dura desta feature: "um sinal não é uma oportunidade
 * comercial só porque foi encontrado por regex ou inferido por IA."
 */
@Injectable()
export class MapSignalToOfferingTool implements AiTool<MapSignalToOfferingInput> {
  readonly name = 'map_signal_to_offering';
  readonly description =
    'Agrupa os sinais confirmados de um lead por oferta da CazaTech sugerida, sempre com a evidência de cada sinal — use para explicar por que uma oferta foi sugerida, nunca para afirmar uma necessidade sem citar o sinal que a sustenta.';
  readonly inputSchema = {
    type: 'object',
    properties: {
      leadId: { type: 'string' },
    },
    required: ['leadId'],
    additionalProperties: false,
  };

  constructor(private readonly leadSignalsService: LeadSignalsService) {}

  execute(input: MapSignalToOfferingInput, context: AiToolContext): Promise<SignalOfferingMapping[]> {
    return this.leadSignalsService.mapToOfferings(context.organizationId, input.leadId);
  }
}
