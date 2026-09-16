import { BadRequestException } from '@nestjs/common';
import { DealSignatureService } from './deal-signature.service';
import type { SignatureService } from '../../infrastructure/signature/signature.service';

function buildDeps() {
  const prisma = {
    customer: { findFirst: jest.fn() },
    dealSignatureRequest: { create: jest.fn(), update: jest.fn(), findMany: jest.fn(), findFirst: jest.fn() },
  };
  const signatureService: jest.Mocked<SignatureService> = {
    createSignatureRequest: jest.fn(),
    getStatus: jest.fn(),
  };
  const auditService = { log: jest.fn().mockResolvedValue(undefined) };
  const dealsService = { findByIdOrThrow: jest.fn() };
  const notificationsService = { create: jest.fn().mockResolvedValue(undefined) };

  const service = new DealSignatureService(
    prisma as never,
    signatureService,
    auditService as never,
    dealsService as never,
    notificationsService as never,
  );

  return { service, prisma, signatureService, auditService, dealsService, notificationsService };
}

const baseDeal = {
  id: 'deal-1',
  organizationId: 'org-1',
  customerId: 'cust-1',
  title: 'Site institucional',
  value: { toString: () => '5000' },
  currency: 'BRL',
  expectedCloseDate: null,
  proposalDraft: 'Minuta de proposta...',
  proposalGeneratedAt: new Date('2026-09-16T10:00:00Z'),
};

const baseCustomer = { id: 'cust-1', organizationId: 'org-1', name: 'João Silva', company: null, email: 'joao@acme.com' };

describe('DealSignatureService.requestSignature', () => {
  it('gera o PDF da proposta, cria a solicitação no provider e persiste com status SENT', async () => {
    const { service, prisma, signatureService, dealsService, auditService } = buildDeps();
    dealsService.findByIdOrThrow.mockResolvedValue(baseDeal);
    prisma.customer.findFirst.mockResolvedValue(baseCustomer);
    signatureService.createSignatureRequest.mockResolvedValue({
      externalEnvelopeId: 'env-1',
      externalDocumentId: 'doc-1',
    });
    prisma.dealSignatureRequest.create.mockResolvedValue({
      id: 'sig-1',
      dealId: 'deal-1',
      status: 'SENT',
      externalEnvelopeId: 'env-1',
    });

    const result = await service.requestSignature('org-1', 'deal-1', 'user-1');

    expect(signatureService.createSignatureRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        signerName: 'João Silva',
        signerEmail: 'joao@acme.com',
        documentFilename: expect.stringContaining('.pdf'),
        documentBase64: expect.any(String),
      }),
    );
    expect(prisma.dealSignatureRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: 'org-1',
        dealId: 'deal-1',
        provider: 'clicksign',
        externalEnvelopeId: 'env-1',
        externalDocumentId: 'doc-1',
        status: 'SENT',
        signerName: 'João Silva',
        signerEmail: 'joao@acme.com',
        actorType: 'USER',
        actorId: 'user-1',
      }),
    });
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'deal.signature_requested', resource: 'Deal:deal-1' }),
    );
    expect(result.id).toBe('sig-1');
  });

  it('rejeita quando o negócio não tem proposta gerada ainda', async () => {
    const { service, dealsService, signatureService } = buildDeps();
    dealsService.findByIdOrThrow.mockResolvedValue({ ...baseDeal, proposalDraft: null });

    await expect(service.requestSignature('org-1', 'deal-1', 'user-1')).rejects.toThrow(BadRequestException);
    expect(signatureService.createSignatureRequest).not.toHaveBeenCalled();
  });

  it('rejeita quando o cliente vinculado não tem e-mail cadastrado', async () => {
    const { service, dealsService, prisma, signatureService } = buildDeps();
    dealsService.findByIdOrThrow.mockResolvedValue(baseDeal);
    prisma.customer.findFirst.mockResolvedValue({ ...baseCustomer, email: null });

    await expect(service.requestSignature('org-1', 'deal-1', 'user-1')).rejects.toThrow(BadRequestException);
    expect(signatureService.createSignatureRequest).not.toHaveBeenCalled();
  });

  it('rejeita quando o cliente vinculado não é encontrado', async () => {
    const { service, dealsService, prisma, signatureService } = buildDeps();
    dealsService.findByIdOrThrow.mockResolvedValue(baseDeal);
    prisma.customer.findFirst.mockResolvedValue(null);

    await expect(service.requestSignature('org-1', 'deal-1', 'user-1')).rejects.toThrow(BadRequestException);
    expect(signatureService.createSignatureRequest).not.toHaveBeenCalled();
  });
});

describe('DealSignatureService.list', () => {
  it('lista as solicitações de assinatura de um negócio, mais recentes primeiro', async () => {
    const { service, prisma } = buildDeps();
    prisma.dealSignatureRequest.findMany.mockResolvedValue([{ id: 'sig-1' }]);

    const result = await service.list('org-1', 'deal-1');

    expect(prisma.dealSignatureRequest.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', dealId: 'deal-1' },
      orderBy: { createdAt: 'desc' },
    });
    expect(result).toEqual([{ id: 'sig-1' }]);
  });
});

describe('DealSignatureService.syncStatusFromProvider', () => {
  it('confirma o status via getStatus (defesa em profundidade, nunca confia só no payload do webhook) e marca SIGNED', async () => {
    const { service, prisma, signatureService, dealsService } = buildDeps();
    prisma.dealSignatureRequest.findFirst.mockResolvedValue({
      id: 'sig-1',
      organizationId: 'org-1',
      dealId: 'deal-1',
      externalEnvelopeId: 'env-1',
      status: 'SENT',
      actorType: 'SYSTEM',
      actorId: null,
    });
    dealsService.findByIdOrThrow.mockResolvedValue({ ...baseDeal, ownerUserId: null });
    signatureService.getStatus.mockResolvedValue({ status: 'closed', documentUrl: 'https://sandbox.clicksign.com/f/abc' });
    prisma.dealSignatureRequest.update.mockResolvedValue({ id: 'sig-1', status: 'SIGNED' });

    const result = await service.syncStatusFromProvider('env-1');

    expect(signatureService.getStatus).toHaveBeenCalledWith('env-1');
    expect(prisma.dealSignatureRequest.update).toHaveBeenCalledWith({
      where: { id: 'sig-1' },
      data: expect.objectContaining({
        status: 'SIGNED',
        documentUrl: 'https://sandbox.clicksign.com/f/abc',
        signedAt: expect.any(Date),
      }),
    });
    expect(result?.status).toBe('SIGNED');
  });

  it('quando assinado, notifica o dono do negócio sugerindo mover pra WON (nunca move o estágio sozinho)', async () => {
    const { service, prisma, signatureService, dealsService, notificationsService } = buildDeps();
    prisma.dealSignatureRequest.findFirst.mockResolvedValue({
      id: 'sig-1',
      organizationId: 'org-1',
      dealId: 'deal-1',
      externalEnvelopeId: 'env-1',
      status: 'SENT',
      actorType: 'USER',
      actorId: 'user-quem-pediu',
    });
    signatureService.getStatus.mockResolvedValue({ status: 'closed', documentUrl: 'https://sandbox.clicksign.com/f/abc' });
    prisma.dealSignatureRequest.update.mockResolvedValue({ id: 'sig-1', status: 'SIGNED' });
    dealsService.findByIdOrThrow.mockResolvedValue({ ...baseDeal, ownerUserId: 'user-dono' });

    await service.syncStatusFromProvider('env-1');

    expect(notificationsService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        userId: 'user-dono',
        type: 'deal.signed',
        payload: expect.objectContaining({ dealId: 'deal-1' }),
      }),
    );
  });

  it('sem dono do deal, notifica quem pediu a assinatura (se for USER)', async () => {
    const { service, prisma, signatureService, dealsService, notificationsService } = buildDeps();
    prisma.dealSignatureRequest.findFirst.mockResolvedValue({
      id: 'sig-1',
      organizationId: 'org-1',
      dealId: 'deal-1',
      externalEnvelopeId: 'env-1',
      status: 'SENT',
      actorType: 'USER',
      actorId: 'user-quem-pediu',
    });
    signatureService.getStatus.mockResolvedValue({ status: 'closed', documentUrl: null });
    prisma.dealSignatureRequest.update.mockResolvedValue({ id: 'sig-1', status: 'SIGNED' });
    dealsService.findByIdOrThrow.mockResolvedValue({ ...baseDeal, ownerUserId: null });

    await service.syncStatusFromProvider('env-1');

    expect(notificationsService.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-quem-pediu' }),
    );
  });

  it('sem dono do deal nem ator humano, não notifica ninguém (nunca lança erro)', async () => {
    const { service, prisma, signatureService, dealsService, notificationsService } = buildDeps();
    prisma.dealSignatureRequest.findFirst.mockResolvedValue({
      id: 'sig-1',
      organizationId: 'org-1',
      dealId: 'deal-1',
      externalEnvelopeId: 'env-1',
      status: 'SENT',
      actorType: 'SYSTEM',
      actorId: null,
    });
    signatureService.getStatus.mockResolvedValue({ status: 'closed', documentUrl: null });
    prisma.dealSignatureRequest.update.mockResolvedValue({ id: 'sig-1', status: 'SIGNED' });
    dealsService.findByIdOrThrow.mockResolvedValue({ ...baseDeal, ownerUserId: null });

    await expect(service.syncStatusFromProvider('env-1')).resolves.not.toThrow();
    expect(notificationsService.create).not.toHaveBeenCalled();
  });

  it('marca CANCELED quando o provider confirma envelope cancelado, sem notificar ninguém', async () => {
    const { service, prisma, signatureService, notificationsService } = buildDeps();
    prisma.dealSignatureRequest.findFirst.mockResolvedValue({
      id: 'sig-1',
      organizationId: 'org-1',
      externalEnvelopeId: 'env-1',
      status: 'SENT',
    });
    signatureService.getStatus.mockResolvedValue({ status: 'canceled', documentUrl: null });
    prisma.dealSignatureRequest.update.mockResolvedValue({ id: 'sig-1', status: 'CANCELED' });

    await service.syncStatusFromProvider('env-1');

    expect(prisma.dealSignatureRequest.update).toHaveBeenCalledWith({
      where: { id: 'sig-1' },
      data: expect.objectContaining({ status: 'CANCELED', canceledAt: expect.any(Date) }),
    });
    expect(notificationsService.create).not.toHaveBeenCalled();
  });

  it('não atualiza nada quando o status ainda não é terminal (draft/running)', async () => {
    const { service, prisma, signatureService } = buildDeps();
    prisma.dealSignatureRequest.findFirst.mockResolvedValue({
      id: 'sig-1',
      externalEnvelopeId: 'env-1',
      status: 'SENT',
    });
    signatureService.getStatus.mockResolvedValue({ status: 'running', documentUrl: null });

    const result = await service.syncStatusFromProvider('env-1');

    expect(prisma.dealSignatureRequest.update).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('ignora silenciosamente um envelope desconhecido (nenhum DealSignatureRequest com esse externalEnvelopeId)', async () => {
    const { service, prisma, signatureService } = buildDeps();
    prisma.dealSignatureRequest.findFirst.mockResolvedValue(null);

    const result = await service.syncStatusFromProvider('env-desconhecido');

    expect(signatureService.getStatus).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });
});
