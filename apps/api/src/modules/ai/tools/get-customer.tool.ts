import { Injectable } from '@nestjs/common';
import type { Customer } from '@opsmind/database';
import { CustomersService } from '../../customers/customers.service';
import type { AiTool, AiToolContext } from './ai-tool.interface';

export interface GetCustomerInput {
  customerId: string;
}

@Injectable()
export class GetCustomerTool implements AiTool<GetCustomerInput> {
  readonly name = 'get_customer';
  readonly description =
    'Busca os dados completos de um cliente do CRM pelo ID (nome, empresa, contato, status, tags).';
  readonly inputSchema = {
    type: 'object',
    properties: {
      customerId: { type: 'string', format: 'uuid', description: 'ID do cliente a buscar.' },
    },
    required: ['customerId'],
    additionalProperties: false,
  };

  constructor(private readonly customersService: CustomersService) {}

  execute(input: GetCustomerInput, context: AiToolContext): Promise<Customer> {
    // `context.organizationId`, nunca algo vindo de `input` — ver
    // ai-tool.interface.ts para o porquê.
    return this.customersService.findByIdOrThrow(context.organizationId, input.customerId);
  }
}
