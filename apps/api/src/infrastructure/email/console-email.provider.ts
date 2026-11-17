import { Injectable, Logger } from '@nestjs/common';
import type { EmailService, SendEmailParams, SendEmailResult, SendInvitationEmailParams } from './email.service';

/** Implementação de dev: loga o email em vez de enviar de verdade. */
@Injectable()
export class ConsoleEmailProvider implements EmailService {
  readonly providerName = 'console';
  readonly costPerMessageUsd = 0;

  private readonly logger = new Logger(ConsoleEmailProvider.name);

  async sendInvitationEmail({ to, organizationName, token }: SendInvitationEmailParams): Promise<void> {
    // eslint-disable-next-line no-console
    console.log(
      `[email:console] Convite para "${organizationName}" enviado a ${to} — token: ${token}`,
    );
    this.logger.log(`Convite (dev) enviado a ${to} para a organização "${organizationName}"`);
  }

  async sendEmail({ to, subject, html }: SendEmailParams): Promise<SendEmailResult> {
    // eslint-disable-next-line no-console
    console.log(`[email:console] "${subject}" enviado a ${to}\n${html}`);
    this.logger.log(`Email (dev) enviado a ${to} — assunto: "${subject}"`);
    return { id: null };
  }
}
