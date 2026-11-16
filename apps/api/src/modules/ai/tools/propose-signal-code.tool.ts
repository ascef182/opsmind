import { ForbiddenException, Injectable } from '@nestjs/common';
import type { SignalCode } from '@opsmind/database';
import { SignalCodesService } from '../../leads/signal-codes.service';
import { WRITE_ROLES } from '../../../shared/constants/roles.constant';
import type { AiTool, AiToolContext } from './ai-tool.interface';

export interface ProposeSignalCodeInput {
  code: string;
  label: string;
  category: string;
}

/**
 * Gated por `WRITE_ROLES` — propor um código grava um `SignalCode` e um
 * `AuditLog` atribuído ao usuário que chamou, então um `VIEWER` não pode
 * fazê-lo via chat. O código sempre nasce `PROPOSED` e escopado à
 * organização: confirmar é ato humano, via endpoint HTTP, nunca desta tool.
 */
@Injectable()
export class ProposeSignalCodeTool implements AiTool<ProposeSignalCodeInput> {
  readonly name = 'propose_signal_code';
  readonly description =
    'Propõe um novo código de sinal (SignalCode) para a organização. O código fica PROPOSED até um administrador confirmá-lo.';
  readonly inputSchema = {
    type: 'object',
    properties: {
      code: { type: 'string' },
      label: { type: 'string' },
      category: { type: 'string' },
    },
    required: ['code', 'label', 'category'],
    additionalProperties: false,
  };

  constructor(private readonly signalCodesService: SignalCodesService) {}

  async execute(input: ProposeSignalCodeInput, context: AiToolContext): Promise<SignalCode> {
    if (!(WRITE_ROLES as readonly string[]).includes(context.role)) {
      throw new ForbiddenException(
        'Seu papel nesta organização não permite propor códigos de sinal — peça a um administrador.',
      );
    }

    const { code, label, category } = input;
    return this.signalCodesService.propose(context.organizationId, { code, label, category }, context.userId);
  }
}
