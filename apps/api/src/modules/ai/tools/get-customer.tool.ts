import { Injectable } from '@nestjs/common';
import type { Customer, Deal } from '@opsmind/database';
import { CustomersService } from '../../customers/customers.service';
import { DealsService } from '../../deals/deals.service';
import type { AiTool, AiToolContext } from './ai-tool.interface';

export interface GetCustomerInput {
  customerId: string;
}

export type GetCustomerOutput = Customer & { openDeals: Deal[] };

@Injectable()
export class GetCustomerTool implements AiTool<GetCustomerInput> {
  readonly name = 'get_customer';
  readonly description =
    'Busca os dados completos de um cliente do CRM pelo ID (nome, empresa, contato, status, tags) e os negócios em aberto vinculados a ele.';
  readonly inputSchema = {
    type: 'object',
    properties: {
      customerId: { type: 'string', format: 'uuid', description: 'ID do cliente a buscar.' },
    },
    required: ['customerId'],
    additionalProperties: false,
  };

  constructor(
    private readonly customersService: CustomersService,
    private readonly dealsService: DealsService,
  ) {}

  async execute(input: GetCustomerInput, context: AiToolContext): Promise<GetCustomerOutput> {
    // `context.organizationId`, nunca algo vindo de `input` — ver
    // ai-tool.interface.ts para o porquê.
    const [customer, openDeals] = await Promise.all([
      this.customersService.findByIdOrThrow(context.organizationId, input.customerId),
      this.dealsService.list(context.organizationId, { customerId: input.customerId, excludeClosed: true }),
    ]);
    return { ...customer, openDeals };
  }
}
