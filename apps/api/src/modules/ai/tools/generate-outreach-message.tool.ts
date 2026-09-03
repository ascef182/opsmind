// REGRA DURA — NÃO ADICIONAR TOOLS DE APROVAÇÃO/ENVIO NESTE MÓDULO:
// `OutreachService` exporta `approve`, `reject`, `regenerate`, `markSent` e
// `markReplied` além de `generateDraft` — esta tool chama SOMENTE
// `generateDraft`. Não existe (e não deve existir) uma tool
// `approve_outreach_message` ou `send_outreach_message` aqui. Isso é
// deliberado: o único caminho para `OutreachMessage.status` sair de `DRAFT`
// é um endpoint humano dedicado (`POST .../outreach-messages/:id/approve`
// etc., protegido por `RolesGuard`), nunca a IA. `AiToolContext` carrega
// `userId`, que passaria no type-check como o `userId` que `approve`/
// `reject`/`markSent`/`markReplied` exigem — por isso essa linha só se
// sustenta porque nenhuma tool chama esses métodos, não porque o
// type-checker impediria. Ver Task 8 (security review) e Global
// Constraints do projeto. Antes de "completar" este arquivo com uma tool de
// aprovação/envio "para simetria", pare e trate como uma preocupação a
// reportar, não como trabalho a fazer.
import { ForbiddenException, Injectable } from '@nestjs/common';
import type { OutreachChannel, OutreachMessage } from '@opsmind/database';
import { OutreachService } from '../../leads/outreach.service';
import { WRITE_ROLES } from '../../../shared/constants/roles.constant';
import type { AiTool, AiToolContext } from './ai-tool.interface';

export interface GenerateOutreachMessageInput {
  leadId: string;
  channel: OutreachChannel;
  serviceOfferingId?: string;
}

/**
 * Gera um RASCUNHO de mensagem de prospecção (`OutreachService.generateDraft`),
 * sempre em status `DRAFT` — nunca aprova nem envia (ver regra dura acima).
 * Gated por `WRITE_ROLES`: chama a IA (consome budget) e cria um registro
 * novo, mesmo racional de `CreateTaskTool`/`AnalyzeLeadPotentialTool`.
 */
@Injectable()
export class GenerateOutreachMessageTool implements AiTool<GenerateOutreachMessageInput> {
  readonly name = 'generate_outreach_message';
  readonly description =
    'Gera um RASCUNHO de mensagem de prospecção para um lead, citando evidência real — nunca aprova nem envia. Precisa de aprovação humana explícita depois.';
  readonly inputSchema = {
    type: 'object',
    properties: {
      leadId: { type: 'string' },
      channel: {
        type: 'string',
        enum: ['EMAIL', 'PHONE', 'WHATSAPP', 'LINKEDIN_DM', 'REDDIT_DM', 'OTHER'],
      },
      serviceOfferingId: { type: 'string' },
    },
    required: ['leadId', 'channel'],
    additionalProperties: false,
  };

  constructor(private readonly outreachService: OutreachService) {}

  async execute(input: GenerateOutreachMessageInput, context: AiToolContext): Promise<OutreachMessage> {
    if (!(WRITE_ROLES as readonly string[]).includes(context.role)) {
      throw new ForbiddenException('Seu papel nesta organização não permite gerar mensagens de prospecção.');
    }

    return this.outreachService.generateDraft(
      context.organizationId,
      input.leadId,
      { channel: input.channel, serviceOfferingId: input.serviceOfferingId },
      context.userId,
    );
  }
}
