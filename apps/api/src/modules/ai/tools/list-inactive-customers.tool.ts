import { Injectable } from '@nestjs/common';
import type { Customer } from '@opsmind/database';
import { CustomersService } from '../../customers/customers.service';
import type { AiTool, AiToolContext } from './ai-tool.interface';

/**
 * Cobre o cenário do critério de aceitação da Fase 3 (PRD §17): "perguntar
 * 'quais clientes sem contato há 14 dias?' retorna dado real via tool call".
 * Sem input — o corte de dias é `organization.inactiveAfterDays`, uma
 * configuração do workspace, não algo que o modelo deveria poder escolher.
 */
@Injectable()
export class ListInactiveCustomersTool implements AiTool<Record<string, never>> {
  readonly name = 'list_inactive_customers';
  readonly description =
    'Lista clientes sem nenhuma atividade registrada há mais dias do que o limite de inatividade configurado no workspace.';
  readonly inputSchema = {
    type: 'object',
    properties: {},
    additionalProperties: false,
  };

  constructor(private readonly customersService: CustomersService) {}

  execute(_input: Record<string, never>, context: AiToolContext): Promise<Customer[]> {
    return this.customersService.listInactive(context.organizationId);
  }
}
