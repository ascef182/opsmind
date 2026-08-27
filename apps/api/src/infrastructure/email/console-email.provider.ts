import { Injectable, Logger } from '@nestjs/common';
import type { EmailService, SendInvitationEmailParams } from './email.service';

/** Implementação de dev: loga o convite em vez de enviar de verdade. */
@Injectable()
export class ConsoleEmailProvider implements EmailService {
  private readonly logger = new Logger(ConsoleEmailProvider.name);

  async sendInvitationEmail({ to, organizationName, token }: SendInvitationEmailParams): Promise<void> {
    // eslint-disable-next-line no-console
    console.log(
      `[email:console] Convite para "${organizationName}" enviado a ${to} — token: ${token}`,
    );
    this.logger.log(`Convite (dev) enviado a ${to} para a organização "${organizationName}"`);
  }
}
