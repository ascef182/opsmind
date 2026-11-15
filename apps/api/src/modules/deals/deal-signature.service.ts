import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { DealSignatureRequest } from '@opsmind/database';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { SIGNATURE_SERVICE, type SignatureService } from '../../infrastructure/signature/signature.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DealsService } from './deals.service';
import { buildProposalPdf } from './utils/build-proposal-pdf';

/**
 * Envio da proposta pra assinatura eletrônica (plano
 * pensando-como-empresa-com-agile-beaver.md, trilha de fechamento — segue
 * "Proposta em PDF": mesma minuta, agora com fluxo de assinatura de
 * verdade). Reaproveita `buildProposalPdf` (mesmo PDF que
 * `DealProposalService.downloadPdf` gera), nunca duplica a renderização.
 *
 * Não altera `Deal.stage` automaticamente quando assinado — isso é a
 * próxima etapa da trilha (sugerir mover pra WON, sempre com confirmação
 * humana). Este service só gerencia o ciclo de vida de
 * `DealSignatureRequest`.
 */
@Injectable()
export class DealSignatureService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(SIGNATURE_SERVICE) private readonly signatureService: SignatureService,
    private readonly auditService: AuditService,
    private readonly dealsService: DealsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async requestSignature(organizationId: string, dealId: string, userId: string): Promise<DealSignatureRequest> {
    const deal = await this.dealsService.findByIdOrThrow(organizationId, dealId);
    if (!deal.proposalDraft) {
      throw new BadRequestException('Gere a proposta antes de enviar para assinatura.');
    }

    const customer = await this.prisma.customer.findFirst({
      where: { id: deal.customerId, organizationId, deletedAt: null },
    });
    if (!customer) {
      throw new BadRequestException('Cliente vinculado ao negócio não encontrado.');
    }
    if (!customer.email) {
      throw new BadRequestException('Cliente não tem e-mail cadastrado — não é possível enviar para assinatura.');
    }

    const pdf = await buildProposalPdf({
      dealTitle: deal.title,
      customerName: customer.name,
      customerCompany: customer.company,
      value: deal.value.toString(),
      currency: deal.currency,
      expectedCloseDate: deal.expectedCloseDate,
      proposalDraft: deal.proposalDraft,
      generatedAt: deal.proposalGeneratedAt,
    });

    const { externalEnvelopeId, externalDocumentId } = await this.signatureService.createSignatureRequest({
      envelopeName: `Proposta — ${deal.title}`,
      documentFilename: `proposta-${dealId}.pdf`,
      documentBase64: pdf.toString('base64'),
      signerName: customer.name,
      signerEmail: customer.email,
    });

    const created = await this.prisma.dealSignatureRequest.create({
      data: {
        organizationId,
        dealId,
        provider: 'clicksign',
        externalEnvelopeId,
        externalDocumentId,
        status: 'SENT',
        signerName: customer.name,
        signerEmail: customer.email,
        actorType: 'USER',
        actorId: userId,
      },
    });

    await this.auditService.log({
      actorType: 'USER',
      actorId: userId,
      organizationId,
      action: 'deal.signature_requested',
      resource: `Deal:${dealId}`,
    });

    return created;
  }

  list(organizationId: string, dealId: string): Promise<DealSignatureRequest[]> {
    return this.prisma.dealSignatureRequest.findMany({
      where: { organizationId, dealId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Chamado pelo `ClicksignWebhookController` — nunca confia no `status` do
   * payload do webhook diretamente (a Clicksign não documenta um esquema de
   * assinatura HMAC pro payload, verificado nesta sessão): sempre confirma
   * o status de verdade via `SignatureService.getStatus` (uma chamada
   * autenticada com o próprio token da conta) antes de gravar qualquer
   * mudança. `null` quando o envelope é desconhecido ou o status ainda não
   * é terminal (nada a fazer).
   */
  async syncStatusFromProvider(externalEnvelopeId: string): Promise<DealSignatureRequest | null> {
    const existing = await this.prisma.dealSignatureRequest.findFirst({
      where: { externalEnvelopeId },
    });
    if (!existing) {
      return null;
    }

    const { status, documentUrl } = await this.signatureService.getStatus(externalEnvelopeId);

    if (status === 'closed') {
      const updated = await this.prisma.dealSignatureRequest.update({
        where: { id: existing.id },
        data: { status: 'SIGNED', documentUrl, signedAt: new Date() },
      });
      // `existing` (não `updated`) — garante organizationId/dealId/actorType
      // mesmo se algum dia `update` usar `select` e devolver menos campos.
      await this.notifyDealSigned(existing);
      return updated;
    }
    if (status === 'canceled') {
      return this.prisma.dealSignatureRequest.update({
        where: { id: existing.id },
        data: { status: 'CANCELED', canceledAt: new Date() },
      });
    }

    // 'draft'/'running' — nada terminal ainda, não há o que atualizar.
    return null;
  }

  /**
   * Notifica pra sugerir mover o negócio pra `WON` — nunca move sozinho
   * (mesma regra dura de toda transição de `Deal.stage`: sempre humana, ver
   * `DealsService.moveStage`). Destinatário: dono do negócio, com fallback
   * pra quem pediu a assinatura (só quando humano) — mesmo racional de
   * `scanMeetingReminders` (apps/worker/src/meeting-reminder-scan.ts).
   */
  private async notifyDealSigned(request: DealSignatureRequest): Promise<void> {
    const deal = await this.dealsService.findByIdOrThrow(request.organizationId, request.dealId);
    const recipientUserId = deal.ownerUserId ?? (request.actorType === 'USER' ? request.actorId : null);
    if (!recipientUserId) {
      return;
    }

    await this.notificationsService.create({
      organizationId: request.organizationId,
      userId: recipientUserId,
      type: 'deal.signed',
      payload: { dealId: deal.id, dealTitle: deal.title },
    });
  }
}
