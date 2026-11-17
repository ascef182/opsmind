import { Inject, Injectable } from '@nestjs/common';
import type { OutreachChannel } from '@opsmind/database';
import { EMAIL_SERVICE, type EmailService } from '../../infrastructure/email/email.service';

export const CHANNEL_SENDERS = Symbol('CHANNEL_SENDERS');

// Payload exato entregue ao provedor. Gravado na reivindicação e reenviado
// igual na reconciliação (mesma chave de idempotência).
export interface ChannelSendRequest {
  to: string;
  subject: string;
  html: string;
  idempotencyKey: string;
}

export interface ChannelSender {
  readonly channel: OutreachChannel;
  readonly providerName: string;
  readonly costPerMessageUsd: number;
  send(request: ChannelSendRequest): Promise<{ providerMessageId: string | null }>;
}

@Injectable()
export class EmailChannelSender implements ChannelSender {
  readonly channel = 'EMAIL' as const;

  constructor(@Inject(EMAIL_SERVICE) private readonly emailService: EmailService) {}

  get providerName(): string {
    return this.emailService.providerName;
  }

  get costPerMessageUsd(): number {
    return this.emailService.costPerMessageUsd;
  }

  async send(request: ChannelSendRequest): Promise<{ providerMessageId: string | null }> {
    const result = await this.emailService.sendEmail(request);
    return { providerMessageId: result.id };
  }
}

// `body` é texto livre (gerado pela IA ou editado), nunca HTML: escapa linha a
// linha. Rodapé de compliance (CAN-SPAM/LGPD): endereço físico + opt-out por
// resposta.
export function renderOutreachHtml(body: string, physicalAddress: string): string {
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const bodyHtml = body
    .split('\n')
    .map((line) => `<p>${escape(line)}</p>`)
    .join('');
  const footerHtml = [
    '<hr/>',
    `<p style="font-size:12px;color:#666;">${escape(physicalAddress)}</p>`,
    '<p style="font-size:12px;color:#666;">Se preferir não receber mais mensagens como esta, é só responder este e-mail pedindo para parar.</p>',
  ].join('');
  return bodyHtml + footerHtml;
}
