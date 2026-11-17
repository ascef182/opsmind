import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import type { Env } from '@opsmind/config/env/schema';
import {
  EmailSendError,
  type EmailService,
  type SendEmailParams,
  type SendEmailResult,
  type SendInvitationEmailParams,
} from './email.service';

// Códigos em que o Resend garante que nada foi enviado.
const NOT_SENT_CODES = new Set([
  'invalid_idempotency_key',
  'validation_error',
  'missing_api_key',
  'restricted_api_key',
  'invalid_api_key',
  'not_found',
  'method_not_allowed',
  'invalid_attachment',
  'invalid_from_address',
  'invalid_access',
  'invalid_parameter',
  'invalid_region',
  'missing_required_field',
  'monthly_quota_exceeded',
  'daily_quota_exceeded',
  'rate_limit_exceeded',
  'security_error',
]);

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
  readonly providerName = 'resend';
  // Estimativa pelo plano Pro (US$20 por 50 mil e-mails). No plano grátis o
  // custo marginal é zero, então isto superestima de leve, nunca subestima.
  readonly costPerMessageUsd = 0.0004;

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
    let response: Awaited<ReturnType<Resend['emails']['send']>>;
    try {
      response = await this.client.emails.send(
        { from: this.from, to: [to], subject, html },
        idempotencyKey ? { idempotencyKey } : undefined,
      );
    } catch (thrown) {
      const message = thrown instanceof Error ? thrown.message : String(thrown);
      this.logger.error(`Falha de rede ao enviar email para ${to}: ${message}`);
      throw new EmailSendError(`Falha ao enviar email: ${message}`, null, 'UNKNOWN');
    }
    const { data, error } = response;

    if (error) {
      this.logger.error(`Falha ao enviar email para ${to}: ${error.message}`);
      const outcome = NOT_SENT_CODES.has(error.name) ? 'NOT_SENT' : 'UNKNOWN';
      throw new EmailSendError(`Falha ao enviar email: ${error.message}`, error.name, outcome);
    }

    this.logger.log(`Email enviado a ${to} (id ${data?.id ?? 'desconhecido'})`);
    return { id: data?.id ?? null };
  }
}
