import { Injectable } from '@nestjs/common';
import type { Customer, CustomerStatus } from '@opsmind/database';
import { CustomersService } from '../../customers/customers.service';
import type { AiTool, AiToolContext } from './ai-tool.interface';

export interface SearchCustomersInput {
  query?: string;
  status?: CustomerStatus;
}

@Injectable()
export class SearchCustomersTool implements AiTool<SearchCustomersInput> {
  readonly name = 'search_customers';
  readonly description =
    'Busca clientes do CRM por nome (busca parcial) e/ou status. Use antes de get_customer quando não tiver o ID.';
  readonly inputSchema = {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Trecho do nome do cliente a buscar.' },
      status: { type: 'string', enum: ['LEAD', 'ACTIVE', 'INACTIVE'] },
    },
    additionalProperties: false,
  };

  constructor(private readonly customersService: CustomersService) {}

  execute(input: SearchCustomersInput, context: AiToolContext): Promise<Customer[]> {
    return this.customersService.list(context.organizationId, {
      search: input.query,
      status: input.status,
    });
  }
}
