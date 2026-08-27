import { Injectable } from '@nestjs/common';
import type { ActivityLog } from '@opsmind/database';
import { CustomersService } from '../../customers/customers.service';
import { ActivityService } from '../../activity/activity.service';
import type { AiTool, AiToolContext } from './ai-tool.interface';

export interface GetCustomerActivityInput {
  customerId: string;
}

@Injectable()
export class GetCustomerActivityTool implements AiTool<GetCustomerActivityInput> {
  readonly name = 'get_customer_activity';
  readonly description = 'Lista a timeline de atividades (notas, tarefas concluídas) de um cliente.';
  readonly inputSchema = {
    type: 'object',
    properties: {
      customerId: { type: 'string', format: 'uuid' },
    },
    required: ['customerId'],
    additionalProperties: false,
  };

  constructor(
    private readonly customersService: CustomersService,
    private readonly activityService: ActivityService,
  ) {}

  async execute(input: GetCustomerActivityInput, context: AiToolContext): Promise<ActivityLog[]> {
    // Confere posse do cliente explicitamente antes de listar a timeline —
    // defesa em profundidade além do RLS: mesmo que a query de activity_logs
    // já seja escopada por organização no banco, checar aqui garante um 404
    // limpo (em vez de uma lista vazia silenciosa) quando o modelo/usuário
    // tenta um customerId de outra organização.
    await this.customersService.findByIdOrThrow(context.organizationId, input.customerId);
    return this.activityService.listForCustomer(context.organizationId, input.customerId);
  }
}
