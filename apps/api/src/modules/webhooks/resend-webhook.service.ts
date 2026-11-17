import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import type { Env } from '@opsmind/config/env/schema';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { EmailWarmupService } from '../../infrastructure/email/email-warmup.service';
import { OutreachService } from '../leads/outreach.service';
import { HarveyActivityRecorder } from '../harvey/harvey-activity.recorder';

export interface ResendWebhookHeaders {
  'svix-id'?: string;
  'svix-timestamp'?: string;
  'svix-signature'?: string;
}

/**
 * Rastreio de resposta (plano pensando-como-empresa-com-agile-beaver.md,
 * sprint de follow-up) — recebe o webhook inbound do Resend
 * (`email.received`) e correlaciona a resposta de volta à `OutreachMessage`
 * original via `providerMessageId` (gravado por `OutreachService.send`),
 * nunca por endereço de email (ambíguo entre organizações — ver comentário
 * em `handleEmailReceived`).
 *
 * Fail-closed: sem `RESEND_WEBHOOK_SECRET`/`RESEND_API_KEY` configurados,
 * todo evento é ignorado (nunca processa payload não verificado — aceitar
 * eventos sem checar assinatura permitiria qualquer um forjar "resposta
 * recebida" e mexer em `Lead.status`/`OutreachMessage.status`).
 */
@Injectable()
export class ResendWebhookService {
  private readonly logger = new Logger(ResendWebhookService.name);

  constructor(
    private readonly configService: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
    private readonly outreachService: OutreachService,
    private readonly emailWarmupService: EmailWarmupService,
    private readonly recorder: HarveyActivityRecorder,
  ) {}

  async handleEvent(rawBody: Buffer, headers: ResendWebhookHeaders): Promise<void> {
    const webhookSecret = this.configService.get('RESEND_WEBHOOK_SECRET', { infer: true });
    const apiKey = this.configService.get('RESEND_API_KEY', { infer: true });
    if (!webhookSecret || !apiKey) {
      this.logger.warn(
        'Webhook do Resend recebido, mas RESEND_WEBHOOK_SECRET/RESEND_API_KEY não configurados nesta instância — ignorando.',
      );
      return;
    }

    const resend = new Resend(apiKey);
    let event: ReturnType<Resend['webhooks']['verify']>;
    try {
      event = resend.webhooks.verify({
        payload: rawBody.toString('utf8'),
        // Formato exigido pelo SDK instalado (resend ^6.28) — `id`/
        // `timestamp`/`signature`, não os nomes de header `svix-*` crus (a
        // documentação da skill resend:resend mostra uma forma mais antiga
        // da API; este é o shape real de `VerifyWebhookOptions.headers`
        // nesta versão).
        headers: {
          id: headers['svix-id'] ?? '',
          timestamp: headers['svix-timestamp'] ?? '',
          signature: headers['svix-signature'] ?? '',
        },
        webhookSecret,
      });
    } catch {
      throw new BadRequestException('Assinatura do webhook do Resend inválida.');
    }

    // Sinal de reputação pro aquecimento do domínio (EmailWarmupService) —
    // registrado independente de qual OutreachMessage originou o evento
    // (contagem agregada por dia, não por mensagem individual): o que importa
    // pra decidir "pode continuar enviando hoje" é a taxa global do domínio,
    // não de qual lead veio.
    if (event.type === 'email.bounced') {
      await this.emailWarmupService.recordBounced();
      return;
    }
    if (event.type === 'email.complained') {
      await this.emailWarmupService.recordComplained();
      return;
    }

    if (event.type !== 'email.received') {
      return;
    }

    await this.handleEmailReceived(resend, event.data.email_id);
  }

  private async handleEmailReceived(resend: Resend, emailId: string): Promise<void> {
    const { data: email, error } = await resend.emails.receiving.get(emailId);
    if (error || !email) {
      this.logger.warn(`Falha ao buscar email recebido ${emailId}: ${error?.message ?? 'sem dados'}`);
      return;
    }

    const inReplyTo = extractMessageId(email.headers?.['in-reply-to'] ?? email.headers?.['In-Reply-To']);
    if (!inReplyTo) {
      return;
    }

    // Lookup GLOBAL (sem organizationId no WHERE) por design: quem responde
    // não é um usuário autenticado desta API, e o único jeito seguro de
    // achar a organização certa é por este id — único no Resend, nunca por
    // endereço de email (poderia ambiguar entre organizações). Fora de
    // qualquer TenantContextInterceptor (webhook não é uma request HTTP
    // autenticada), RLS cai no fallback documentado em
    // enable_row_level_security — mesma classe de exceção que os scans do
    // worker já usam para varreduras cross-tenant.
    const message = await this.prisma.outreachMessage.findFirst({
      where: { providerMessageId: inReplyTo },
    });
    if (!message) {
      this.logger.debug(`Resposta recebida sem OutreachMessage correspondente (providerMessageId=${inReplyTo}).`);
      return;
    }

    try {
      await this.outreachService.markRepliedFromWebhook(message.organizationId, message.id);
      const lead = await this.prisma.lead.findFirst({
        where: { id: message.leadId, organizationId: message.organizationId },
        select: { name: true, campaignId: true },
      });
      await this.recorder.event({
        organizationId: message.organizationId,
        type: 'outreach.reply_received',
        phase: 'RESPONDING',
        title: `Resposta recebida de ${lead?.name ?? 'lead'}`,
        idempotencyKey: `outreach.reply_received:${message.id}`,
        status: 'SUCCEEDED',
        leadId: message.leadId,
        campaignId: lead?.campaignId ?? null,
        outreachMessageId: message.id,
        channel: message.channel,
      });
    } catch (err) {
      // Idempotência: o Resend pode reentregar o mesmo evento, ou a mensagem
      // já pode ter sido marcada respondida manualmente nesse meio-tempo —
      // `markRepliedFromWebhook` já rejeita transições fora de SENT, o que
      // aqui é esperado, não uma falha real a propagar.
      this.logger.debug(
        `markRepliedFromWebhook ignorado para ${message.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

function extractMessageId(header: string | undefined): string | null {
  if (!header) {
    return null;
  }
  const match = header.match(/<([^>]+)>/);
  return match?.[1] ?? header.trim();
}
