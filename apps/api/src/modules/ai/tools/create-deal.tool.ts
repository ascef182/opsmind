import { ForbiddenException, Injectable } from '@nestjs/common';
import type { Deal } from '@opsmind/database';
import { DealsService } from '../../deals/deals.service';
import { WRITE_ROLES } from '../../../shared/constants/roles.constant';
import type { AiTool, AiToolContext } from './ai-tool.interface';

export interface CreateDealInput {
  customerId: string;
  title: string;
  value: number;
  currency?: string;
  expectedCloseDate?: string;
}

/**
 * Gated por `WRITE_ROLES` — cria uma linha em `Deal` (stage QUALIFICATION,
 * default do schema) e uma entrada de `AuditLog`. Nunca aceita `stage`,
 * `organizationId` ou `ownerUserId` vindos do modelo — mesma fronteira de
 * segurança documentada em `ai-tool.interface.ts`.
 */
@Injectable()
export class CreateDealTool implements AiTool<CreateDealInput> {
  readonly name = 'create_deal';
  readonly description =
    'Cria um novo negócio (deal) em negociação para um cliente, sempre no estágio inicial de qualificação.';
  readonly inputSchema = {
    type: 'object',
    properties: {
      customerId: { type: 'string', format: 'uuid' },
      title: { type: 'string' },
      value: { type: 'number', description: 'Valor estimado do contrato.' },
      currency: { type: 'string', description: 'Código da moeda, ex.: BRL, USD. Default BRL.' },
      expectedCloseDate: { type: 'string', format: 'date-time' },
    },
    required: ['customerId', 'title', 'value'],
    additionalProperties: false,
  };

  constructor(private readonly dealsService: DealsService) {}

  async execute(input: CreateDealInput, context: AiToolContext): Promise<Deal> {
    if (!(WRITE_ROLES as readonly string[]).includes(context.role)) {
      throw new ForbiddenException(
        'Seu papel nesta organização não permite criar negócios — peça a um administrador.',
      );
    }

    return this.dealsService.create(
      context.organizationId,
      {
        customerId: input.customerId,
        title: input.title,
        value: input.value,
        currency: input.currency,
        expectedCloseDate: input.expectedCloseDate ? new Date(input.expectedCloseDate) : undefined,
      },
      context.userId,
    );
  }
}
