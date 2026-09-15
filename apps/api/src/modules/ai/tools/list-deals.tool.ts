import { Injectable } from '@nestjs/common';
import type { Deal, DealStage } from '@opsmind/database';
import { DealsService } from '../../deals/deals.service';
import type { AiTool, AiToolContext } from './ai-tool.interface';

export interface ListDealsInput {
  stage?: DealStage;
  customerId?: string;
}

// Leitura pura, sem gate de WRITE_ROLES — mesmo padrão de
// `search-customers.tool.ts`/`list-tasks.tool.ts`.
@Injectable()
export class ListDealsTool implements AiTool<ListDealsInput> {
  readonly name = 'list_deals';
  readonly description = 'Lista os negócios (deals) da organização, opcionalmente filtrados por estágio ou cliente.';
  readonly inputSchema = {
    type: 'object',
    properties: {
      stage: {
        type: 'string',
        enum: ['QUALIFICATION', 'PROPOSAL', 'NEGOTIATION', 'CONTRACT_SENT', 'WON', 'LOST'],
      },
      customerId: { type: 'string', format: 'uuid' },
    },
    required: [],
    additionalProperties: false,
  };

  constructor(private readonly dealsService: DealsService) {}

  execute(input: ListDealsInput, context: AiToolContext): Promise<Deal[]> {
    return this.dealsService.list(context.organizationId, {
      stage: input.stage,
      customerId: input.customerId,
    });
  }
}
