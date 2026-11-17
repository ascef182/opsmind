import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  HARVEY_SKIP_REASON_LABELS,
  checkHarveyMayProceed,
  recordCostEvent,
  type OutreachMessage,
  type Prisma,
} from '@opsmind/database';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { flushAfterCommit } from '../../shared/context/after-commit';
import { tenantContextStorage } from '../../shared/context/tenant-context.storage';
import { EmailSendError } from '../../infrastructure/email/email.service';
import { EmailWarmupService } from '../../infrastructure/email/email-warmup.service';
import { AuditService } from '../audit/audit.service';
import { HarveyActivityRecorder } from '../harvey/harvey-activity.recorder';
import { PipelineHistoryService } from '../revenue/pipeline-history.service';
import { RevenueSettingsService } from '../revenue/revenue-settings.service';
import {
  CHANNEL_SENDERS,
  renderOutreachHtml,
  type ChannelSendRequest,
  type ChannelSender,
} from './channel-senders';

export type SendInitiator = { type: 'USER'; userId: string } | { type: 'HARVEY' };

// Janela em que reenviar com a mesma chave é seguro: o Resend guarda a chave de
// idempotência por 24h. Depois disso um reenvio poderia duplicar.
export const RECONCILE_WINDOW_MS = 23 * 3_600_000;

type ReconcileOutcome = 'SENT' | 'STILL_UNKNOWN' | 'NOT_APPLICABLE';

/**
 * Envio real de outreach, neutro de canal, com garantia de no máximo um envio:
 * 1. checagens de política (pausa global, liberação da organização, teto
 *    diário, opt-out, endereço físico, aquecimento);
 * 2. reivindicação atômica APPROVED → SENDING numa transação própria e já
 *    confirmada, junto com o payload exato;
 * 3. só para envio iniciado pelo Harvey: verificação final do estado do agente,
 *    lida do banco logo antes do provedor (o operador humano nunca é bloqueado
 *    pelo estado do agente);
 * 4. provedor com chave de idempotência fixa por mensagem;
 * 5. resultado confirmado numa transação própria: SENT, de volta a APPROVED
 *    (recusa garantida do provedor) ou SEND_UNKNOWN (pode ter saído).
 * SEND_UNKNOWN é resolvido por `reconcile` (reenvio idempotente dentro da
 * janela) ou por uma pessoa (`resolveUnknown`). Nunca há reenvio cego.
 */
@Injectable()
export class OutreachDispatchService {
  private readonly logger = new Logger(OutreachDispatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CHANNEL_SENDERS) private readonly senders: ChannelSender[],
    private readonly revenueSettings: RevenueSettingsService,
    private readonly emailWarmupService: EmailWarmupService,
    private readonly pipelineHistory: PipelineHistoryService,
    private readonly auditService: AuditService,
    private readonly recorder: HarveyActivityRecorder,
  ) {}

  async dispatch(organizationId: string, messageId: string, initiator: SendInitiator): Promise<OutreachMessage> {
    const message = await this.findOrThrow(organizationId, messageId);
    if (message.status !== 'APPROVED') {
      throw new ConflictException(`A mensagem está em ${message.status}; só mensagens aprovadas podem ser enviadas.`);
    }
    await this.revenueSettings.assertCanSendOutreach(organizationId);
    const sender = this.senderFor(message.channel);
    const lead = await this.loadLead(organizationId, message.leadId);
    const claimedAt = new Date();
    // Chave de idempotência por reivindicação: a janela de reconciliação (23h a
    // partir de sendClaimedAt) e a validade da chave no provedor (24h) andam juntas.
    const request = await this.buildRequest(organizationId, message, lead, claimedAt);
    if (sender.channel === 'EMAIL') {
      const warmup = await this.emailWarmupService.checkCanSend();
      if (warmup.blocked) throw new ServiceUnavailableException(warmup.reason);
    }

    const claimed = await this.prisma.runDetachedTenantTransaction(organizationId, (tx) =>
      tx.outreachMessage.updateMany({
        where: { id: messageId, organizationId, status: 'APPROVED' },
        data: {
          status: 'SENDING',
          sendClaimedAt: claimedAt,
          sendInitiator: initiator.type,
          sendRequest: request as unknown as Prisma.InputJsonValue,
          sendError: null,
        },
      }),
    );
    if (claimed.count === 0) {
      throw new ConflictException('Esta mensagem já foi enviada ou está sendo enviada.');
    }

    if (initiator.type === 'HARVEY') {
      const check = await this.prisma.runDetachedTenantTransaction(organizationId, (tx) =>
        checkHarveyMayProceed(tx, { organizationId, campaignId: lead.campaignId, step: 'send' }),
      );
      if (!check.ok) {
        await this.releaseClaim(organizationId, messageId, HARVEY_SKIP_REASON_LABELS[check.reason]);
        await this.recorder.event({
          organizationId,
          type: 'outreach.send_blocked',
          phase: 'SENDING',
          title: `Envio para ${lead.name} bloqueado — ${HARVEY_SKIP_REASON_LABELS[check.reason]}`,
          idempotencyKey: `outreach.send_blocked:${messageId}:${claimedAt.getTime()}`,
          status: 'SKIPPED',
          leadId: lead.id,
          campaignId: lead.campaignId,
          outreachMessageId: messageId,
          channel: message.channel,
        });
        throw new ForbiddenException(`Envio bloqueado: ${HARVEY_SKIP_REASON_LABELS[check.reason]}.`);
      }
    }

    let providerMessageId: string | null;
    try {
      ({ providerMessageId } = await sender.send(request));
    } catch (error) {
      return this.handleProviderFailure(organizationId, message, lead, error);
    }

    const { message: sent, transitioned } = await this.markSent(organizationId, messageId, providerMessageId);
    if (transitioned) await this.afterSent(organizationId, sent, lead, sender, initiator, 'outreach.sent');
    return sent;
  }

  /**
   * Resolve um SEND_UNKNOWN reenviando o MESMO payload com a MESMA chave. Se o
   * provedor já tinha recebido, devolve a resposta original sem enviar de novo;
   * se não tinha, o envio autorizado acontece agora, uma única vez.
   */
  async reconcile(organizationId: string, messageId: string, now: Date = new Date()): Promise<ReconcileOutcome> {
    const message = await this.prisma.outreachMessage.findFirst({ where: { id: messageId, organizationId } });
    if (!message || message.status !== 'SEND_UNKNOWN' || !message.sendRequest || !message.sendClaimedAt) {
      return 'NOT_APPLICABLE';
    }
    if (now.getTime() - message.sendClaimedAt.getTime() > RECONCILE_WINDOW_MS) {
      await this.setSendError(organizationId, messageId, 'Janela de reconciliação expirada — decisão manual necessária.');
      return 'STILL_UNKNOWN';
    }
    const lead = await this.loadLead(organizationId, message.leadId);
    const blocker = await this.reconcileBlocker(organizationId, message, lead.campaignId, lead.unsubscribedAt);
    if (blocker) {
      await this.setSendError(organizationId, messageId, blocker);
      return 'STILL_UNKNOWN';
    }

    const sender = this.senderFor(message.channel);
    // Reivindica antes do provedor: uma decisão humana concorrente
    // (resolve-unknown) não consegue mudar a mensagem enquanto isso.
    const claimed = await this.prisma.runDetachedTenantTransaction(organizationId, (tx) =>
      tx.outreachMessage.updateMany({
        where: { id: messageId, organizationId, status: 'SEND_UNKNOWN' },
        data: { status: 'SENDING' },
      }),
    );
    if (claimed.count === 0) return 'NOT_APPLICABLE';

    let providerMessageId: string | null;
    try {
      ({ providerMessageId } = await sender.send(message.sendRequest as unknown as ChannelSendRequest));
    } catch (error) {
      const reason = (error instanceof Error ? error.message : String(error)).slice(0, 500);
      await this.prisma.runDetachedTenantTransaction(organizationId, (tx) =>
        tx.outreachMessage.updateMany({
          where: { id: messageId, organizationId, status: 'SENDING' },
          data: { status: 'SEND_UNKNOWN', sendError: reason },
        }),
      );
      return 'STILL_UNKNOWN';
    }

    const { message: sent, transitioned } = await this.markSent(organizationId, messageId, providerMessageId);
    if (transitioned) {
      await this.afterSent(organizationId, sent, lead, sender, { type: 'HARVEY' }, 'outreach.send_reconciled');
    }
    return 'SENT';
  }

  // Decisão humana sobre um SEND_UNKNOWN: confirmou no provedor que saiu (SENT)
  // ou que não saiu (volta a APPROVED para um novo envio).
  async resolveUnknown(
    organizationId: string,
    messageId: string,
    outcome: 'SENT' | 'NOT_SENT',
    userId: string,
  ): Promise<OutreachMessage> {
    const message = await this.findOrThrow(organizationId, messageId);
    if (message.status !== 'SEND_UNKNOWN') {
      throw new ConflictException(`A mensagem está em ${message.status}, não em envio sem confirmação.`);
    }
    const updated = await this.prisma.runDetachedTenantTransaction(organizationId, async (tx) => {
      const { count } = await tx.outreachMessage.updateMany({
        where: { id: messageId, organizationId, status: 'SEND_UNKNOWN' },
        data:
          outcome === 'SENT'
            ? { status: 'SENT', sentAt: message.sendClaimedAt ?? new Date(), sendError: null }
            : { status: 'APPROVED', sendClaimedAt: null, sendInitiator: null, sendError: null },
      });
      if (count === 0) throw new ConflictException('A mensagem mudou de estado; recarregue e tente de novo.');
      return tx.outreachMessage.findFirstOrThrow({ where: { id: messageId, organizationId } });
    });
    if (outcome === 'SENT') {
      await this.setLeadContacted(organizationId, updated.leadId, { type: 'USER', id: userId });
    }
    await this.auditService.log({
      actorType: 'USER',
      actorId: userId,
      organizationId,
      action: 'outreach.send_unknown_resolved',
      resource: messageId,
      metadata: { outcome },
    });
    return updated;
  }

  private async reconcileBlocker(
    organizationId: string,
    message: OutreachMessage,
    campaignId: string | null,
    unsubscribedAt: Date | null,
  ): Promise<string | null> {
    if (this.revenueSettings.isGloballyPaused()) return 'Envio pausado globalmente (OUTREACH_GLOBAL_PAUSE).';
    const settings = await this.revenueSettings.get(organizationId);
    if (settings.outreachPaused) return 'Envio de outreach pausado na organização.';
    if (unsubscribedAt) return 'O lead pediu para não receber mensagens.';
    if (message.sendInitiator === 'HARVEY') {
      const check = await checkHarveyMayProceed(this.prisma, { organizationId, campaignId, step: 'send' });
      if (!check.ok) return HARVEY_SKIP_REASON_LABELS[check.reason];
    }
    return null;
  }

  private async handleProviderFailure(
    organizationId: string,
    message: OutreachMessage,
    lead: { id: string; name: string; campaignId: string | null },
    error: unknown,
  ): Promise<never> {
    const reason = error instanceof Error ? error.message : String(error);
    const definitelyNotSent = error instanceof EmailSendError && error.outcome === 'NOT_SENT';
    if (definitelyNotSent) {
      await this.releaseClaim(organizationId, message.id, reason);
      throw new ServiceUnavailableException(`O provedor recusou o envio; nada foi enviado. ${reason}`);
    }
    await this.prisma.runDetachedTenantTransaction(organizationId, (tx) =>
      tx.outreachMessage.updateMany({
        where: { id: message.id, organizationId, status: 'SENDING' },
        data: { status: 'SEND_UNKNOWN', sendError: reason.slice(0, 500) },
      }),
    );
    await this.recorder.event({
      organizationId,
      type: 'outreach.send_uncertain',
      phase: 'SENDING',
      title: `Envio para ${lead.name} sem confirmação do provedor — será reconciliado`,
      idempotencyKey: `outreach.send_uncertain:${message.id}:${message.updatedAt.getTime()}`,
      status: 'FAILED',
      errorMessage: reason.slice(0, 500),
      leadId: lead.id,
      campaignId: lead.campaignId,
      outreachMessageId: message.id,
      channel: message.channel,
    });
    this.logger.warn(`Envio ${message.id} ficou sem confirmação: ${reason}`);
    throw new BadGatewayException(
      'O provedor não confirmou o envio. A mensagem ficou como "envio sem confirmação" e será reconciliada sem duplicar.',
    );
  }

  // Registros do envio já confirmado ficam numa transação própria: um rollback
  // da request (timeout, erro depois do envio) não pode apagá-los.
  private async afterSent(
    organizationId: string,
    sent: OutreachMessage,
    lead: { id: string; name: string; campaignId: string | null },
    sender: ChannelSender,
    initiator: SendInitiator,
    activityType: 'outreach.sent' | 'outreach.send_reconciled',
  ): Promise<void> {
    if (sender.channel === 'EMAIL') await this.emailWarmupService.recordSent();
    let committedTx: object | undefined;
    await this.prisma.runDetachedTenantTransaction(organizationId, (tx) => {
      committedTx = tx;
      return tenantContextStorage.run(tx, () =>
        this.recordSent(organizationId, sent, lead, sender, initiator, activityType),
      );
    });
    if (committedTx) await flushAfterCommit(committedTx);
  }

  private async recordSent(
    organizationId: string,
    sent: OutreachMessage,
    lead: { id: string; name: string; campaignId: string | null },
    sender: ChannelSender,
    initiator: SendInitiator,
    activityType: 'outreach.sent' | 'outreach.send_reconciled',
  ): Promise<void> {
    await recordCostEvent(this.prisma, {
      organizationId,
      category: 'EMAIL',
      provider: sender.providerName,
      operation: 'outreach.send',
      agent: 'outreach-copywriting',
      amountUsd: sender.costPerMessageUsd,
      leadId: lead.id,
    });
    const actor = initiator.type === 'USER' ? { type: 'USER' as const, id: initiator.userId } : { type: 'SYSTEM' as const };
    await this.setLeadContacted(organizationId, lead.id, actor);
    await this.auditService.log({
      actorType: actor.type,
      actorId: initiator.type === 'USER' ? initiator.userId : null,
      organizationId,
      action: activityType === 'outreach.sent' ? 'outreach.send' : 'outreach.send_reconciled',
      resource: sent.id,
    });
    await this.recorder.event({
      organizationId,
      type: activityType,
      phase: 'SENDING',
      title:
        activityType === 'outreach.sent'
          ? `Mensagem enviada para ${lead.name}`
          : `Envio para ${lead.name} confirmado na reconciliação`,
      idempotencyKey: `${activityType}:${sent.id}`,
      status: 'SUCCEEDED',
      leadId: lead.id,
      campaignId: lead.campaignId,
      outreachMessageId: sent.id,
      channel: sent.channel,
      result: { providerMessageId: sent.providerMessageId },
      actorType: actor.type,
      actorId: initiator.type === 'USER' ? initiator.userId : null,
    });
  }

  // Aceita SENDING ou SEND_UNKNOWN (o tick pode ter marcado o envio lento como
  // sem confirmação). Só quem faz a transição grava custo, lead e auditoria.
  private async markSent(
    organizationId: string,
    messageId: string,
    providerMessageId: string | null,
  ): Promise<{ message: OutreachMessage; transitioned: boolean }> {
    return this.prisma.runDetachedTenantTransaction(organizationId, async (tx) => {
      const { count } = await tx.outreachMessage.updateMany({
        where: { id: messageId, organizationId, status: { in: ['SENDING', 'SEND_UNKNOWN'] } },
        data: { status: 'SENT', sentAt: new Date(), providerMessageId, sendError: null },
      });
      if (count === 0) {
        this.logger.warn(`Envio ${messageId} já tinha sido resolvido por outro processo.`);
      }
      const message = await tx.outreachMessage.findFirstOrThrow({ where: { id: messageId, organizationId } });
      return { message, transitioned: count === 1 };
    });
  }

  private releaseClaim(organizationId: string, messageId: string, reason: string) {
    return this.prisma.runDetachedTenantTransaction(organizationId, (tx) =>
      tx.outreachMessage.updateMany({
        where: { id: messageId, organizationId, status: 'SENDING' },
        data: { status: 'APPROVED', sendClaimedAt: null, sendInitiator: null, sendError: reason.slice(0, 500) },
      }),
    );
  }

  private setSendError(organizationId: string, messageId: string, reason: string) {
    return this.prisma.runDetachedTenantTransaction(organizationId, (tx) =>
      tx.outreachMessage.updateMany({
        where: { id: messageId, organizationId, status: 'SEND_UNKNOWN' },
        data: { sendError: reason.slice(0, 500) },
      }),
    );
  }

  private async setLeadContacted(
    organizationId: string,
    leadId: string,
    actor: { type: 'USER'; id: string } | { type: 'SYSTEM' },
  ): Promise<void> {
    const current = await this.prisma.lead.findFirst({ where: { id: leadId, organizationId }, select: { status: true } });
    if (!current || current.status === 'CONTACTED') return;
    await this.prisma.lead.update({ where: { id: leadId }, data: { status: 'CONTACTED' } });
    await this.pipelineHistory.leadStatusChanged(organizationId, leadId, current.status, 'CONTACTED', actor);
  }

  private senderFor(channel: OutreachMessage['channel']): ChannelSender {
    const sender = this.senders.find((candidate) => candidate.channel === channel);
    if (!sender) {
      throw new BadRequestException(
        'Este canal ainda não está conectado para envio automático — use "marcar como enviada" depois de enviar por fora.',
      );
    }
    return sender;
  }

  private async findOrThrow(organizationId: string, messageId: string): Promise<OutreachMessage> {
    const message = await this.prisma.outreachMessage.findFirst({ where: { id: messageId, organizationId } });
    if (!message) throw new NotFoundException('Mensagem de outreach não encontrada');
    return message;
  }

  private async loadLead(organizationId: string, leadId: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, organizationId },
      select: { id: true, name: true, email: true, campaignId: true, unsubscribedAt: true },
    });
    if (!lead) throw new NotFoundException('Lead não encontrado');
    return lead;
  }

  private async buildRequest(
    organizationId: string,
    message: OutreachMessage,
    lead: { name: string; email: string | null; unsubscribedAt: Date | null },
    claimedAt: Date,
  ): Promise<ChannelSendRequest> {
    if (!lead.email) {
      throw new BadRequestException('Lead não tem e-mail cadastrado — não é possível enviar automaticamente.');
    }
    if (lead.unsubscribedAt) {
      throw new BadRequestException('Este lead pediu para não receber mais mensagens — envio bloqueado.');
    }
    const organization = await this.prisma.organization.findFirst({
      where: { id: organizationId },
      select: { outreachPhysicalAddress: true },
    });
    if (!organization?.outreachPhysicalAddress) {
      throw new BadRequestException(
        'Configure o endereço físico de correspondência da organização (outreachPhysicalAddress) antes de enviar outreach por e-mail — exigido por lei (CAN-SPAM).',
      );
    }
    return {
      to: lead.email,
      subject: message.subject ?? `Contato — ${lead.name}`,
      html: renderOutreachHtml(message.body, organization.outreachPhysicalAddress),
      idempotencyKey: `outreach-message/${message.id}/${claimedAt.getTime()}`,
    };
  }
}
