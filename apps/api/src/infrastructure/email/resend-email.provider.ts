import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import type { Env } from '@opsmind/config/env/schema';
import type { EmailService, SendEmailParams, SendEmailResult, SendInvitationEmailParams } from './email.service';

/**
 * Implementação real via SDK oficial do Resend (resend:resend skill: SDK
 * Node.js nunca lança em erro de API — sempre `{ data, error }`, checado
 * explicitamente abaixo, nunca try/catch pra isso).
 *
 * Ao contrário de `ClaudeGatewayService`/`OpenAiEmbeddingGateway` (client
 * construído lazy no primeiro uso, porque a chave é opcional em QUALQUER
 * `EMAIL_PROVIDER`), esta classe só é instanciada quando `EMAIL_PROVIDER=resend`
 * (ver `EmailModule`) — nesse caso `RESEND_API_KEY` É obrigatória, então falha
 * no construtor é o sinal certo (equivalente a um fail-fast de boot, não um
 * fail-late de uso).
 */
@Injectable()
export class ResendEmailProvider implements EmailService {
  private readonly logger = new Logger(ResendEmailProvider.name);
  private readonly client: Resend;
  private readonly from: string;

  constructor(configService: ConfigService<Env, true>) {
    const apiKey = configService.get('RESEND_API_KEY', { infer: true });
    if (!apiKey) {
      throw new Error(
        'RESEND_API_KEY ausente — obrigatória quando EMAIL_PROVIDER=resend.',
      );
    }
    this.client = new Resend(apiKey);
    this.from = configService.get('RESEND_FROM_EMAIL', { infer: true });
  }

  async sendInvitationEmail({ to, organizationName, token }: SendInvitationEmailParams): Promise<void> {
    await this.sendEmail({
      to,
      subject: `Convite para ${organizationName} no OpsMind`,
      html: `<p>Você foi convidado para a organização <strong>${organizationName}</strong> no OpsMind.</p><p>Código do convite: <code>${token}</code></p>`,
      idempotencyKey: `invitation/${token}`,
    });
  }

  async sendEmail({ to, subject, html, idempotencyKey }: SendEmailParams): Promise<SendEmailResult> {
    const { data, error } = await this.client.emails.send(
      { from: this.from, to: [to], subject, html },
      idempotencyKey ? { idempotencyKey } : undefined,
    );

    if (error) {
      this.logger.error(`Falha ao enviar email para ${to}: ${error.message}`);
      throw new ServiceUnavailableException(`Falha ao enviar email: ${error.message}`);
    }

    this.logger.log(`Email enviado a ${to} (id ${data?.id ?? 'desconhecido'})`);
    return { id: data?.id ?? null };
  }
}
