import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { OutreachService } from './outreach.service';
import type { AiGateway } from '../ai/gateway/ai-gateway.interface';

function buildDeps() {
  const prisma = {
    outreachMessage: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    lead: { update: jest.fn().mockResolvedValue({ id: 'lead-1' }) },
    aIRequest: { create: jest.fn().mockResolvedValue({ id: 'ai-req-1' }) },
  };

  const gateway: jest.Mocked<AiGateway> = { sendMessage: jest.fn() };

  const budgetService = {
    isOverBudget: jest.fn().mockResolvedValue(false),
    recordSpend: jest.fn().mockResolvedValue(undefined),
  };

  const organizationsService = {
    findById: jest.fn().mockResolvedValue({ id: 'org-1', aiMonthlyBudget: null }),
  };

  const auditService = { log: jest.fn().mockResolvedValue(undefined) };

  const leadsService = { findByIdOrThrow: jest.fn() };
  const serviceOfferingsService = { findByIdOrThrow: jest.fn() };

  const service = new OutreachService(
    prisma as never,
    gateway,
    budgetService as never,
    organizationsService as never,
    auditService as never,
    leadsService as never,
    serviceOfferingsService as never,
  );

  return {
    service,
    prisma,
    gateway,
    budgetService,
    organizationsService,
    auditService,
    leadsService,
    serviceOfferingsService,
  };
}

const baseLead = {
  id: 'lead-1',
  organizationId: 'org-1',
  status: 'QUALIFIED',
  name: 'Padaria Central',
  address: 'Rua X, 100',
  city: 'São Paulo',
  state: 'SP',
  googleCategory: 'Padaria',
  rating: 4.5,
  reviewCount: 20,
  website: null,
  rawContent: null,
  suggestedOfferingId: 'offering-1',
  scoreBreakdown: { matchedSignals: ['sem site próprio'] },
};

const baseOffering = {
  id: 'offering-1',
  organizationId: 'org-1',
  name: 'Presença online para pequenos negócios',
  description: 'Criamos e mantemos um site simples para negócios locais.',
};

function mockGatewayResponse(text: string, inputTokens = 100, outputTokens = 50) {
  return {
    id: 'msg_1',
    stop_reason: 'end_turn',
    content: [{ type: 'text', text }],
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  } as never;
}

describe('OutreachService', () => {
  describe('generateDraft', () => {
    it('gera um DRAFT citando evidência (scoreBreakdown.matchedSignals) e linka o AIRequest', async () => {
      const { service, prisma, gateway, leadsService, serviceOfferingsService, budgetService, auditService } =
        buildDeps();
      leadsService.findByIdOrThrow.mockResolvedValue(baseLead);
      serviceOfferingsService.findByIdOrThrow.mockResolvedValue(baseOffering);
      gateway.sendMessage.mockResolvedValue(mockGatewayResponse('Olá! Vi que vocês não têm site...'));
      prisma.aIRequest.create.mockResolvedValue({ id: 'ai-req-1' });
      prisma.outreachMessage.create.mockResolvedValue({ id: 'msg-1', status: 'DRAFT' });

      const result = await service.generateDraft('org-1', 'lead-1', { channel: 'EMAIL' }, 'user-1');

      expect(leadsService.findByIdOrThrow).toHaveBeenCalledWith('org-1', 'lead-1');
      expect(serviceOfferingsService.findByIdOrThrow).toHaveBeenCalledWith('org-1', 'offering-1');
      expect(gateway.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ tools: [], messages: [{ role: 'user', content: expect.any(String) }] }),
      );
      const promptSent = gateway.sendMessage.mock.calls[0]?.[0]?.messages[0]?.content as string;
      expect(promptSent).toContain('NÃO TEM SITE');
      expect(promptSent).toContain('sem site próprio');

      // AIRequest.SUCCESS persistido ANTES do OutreachMessage, para poder
      // linkar o id — mesma trilha de custo/observabilidade de AiService.chat.
      expect(prisma.aIRequest.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: 'org-1',
          userId: 'user-1',
          status: 'SUCCESS',
          inputTokens: 100,
          outputTokens: 50,
          estimatedCost: expect.any(Number),
        }),
      });

      expect(prisma.outreachMessage.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: 'org-1',
          leadId: 'lead-1',
          serviceOfferingId: 'offering-1',
          channel: 'EMAIL',
          status: 'DRAFT',
          actorType: 'AI',
          actorId: null,
          aiRequestId: 'ai-req-1',
          evidenceQuotes: ['sem site próprio'],
        }),
      });
      expect(budgetService.recordSpend).toHaveBeenCalledWith('org-1', expect.any(Number));
      expect(prisma.lead.update).toHaveBeenCalledWith({
        where: { id: 'lead-1' },
        data: { status: 'OUTREACH_DRAFTED' },
      });
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          actorType: 'USER',
          actorId: 'user-1',
          action: 'outreach.draft_generated',
          resource: 'OutreachMessage:msg-1',
        }),
      );
      expect(result).toEqual({ id: 'msg-1', status: 'DRAFT' });
    });

    it('usa dto.serviceOfferingId quando fornecido, ignorando suggestedOfferingId', async () => {
      const { service, prisma, gateway, leadsService, serviceOfferingsService } = buildDeps();
      leadsService.findByIdOrThrow.mockResolvedValue(baseLead);
      serviceOfferingsService.findByIdOrThrow.mockResolvedValue({ ...baseOffering, id: 'offering-2' });
      gateway.sendMessage.mockResolvedValue(mockGatewayResponse('rascunho'));
      prisma.outreachMessage.create.mockResolvedValue({ id: 'msg-1' });

      await service.generateDraft('org-1', 'lead-1', { channel: 'EMAIL', serviceOfferingId: 'offering-2' }, 'user-1');

      expect(serviceOfferingsService.findByIdOrThrow).toHaveBeenCalledWith('org-1', 'offering-2');
    });

    it('lança BadRequestException quando não há serviceOfferingId nem suggestedOfferingId', async () => {
      const { service, leadsService, serviceOfferingsService, prisma } = buildDeps();
      leadsService.findByIdOrThrow.mockResolvedValue({ ...baseLead, suggestedOfferingId: null });

      await expect(
        service.generateDraft('org-1', 'lead-1', { channel: 'EMAIL' }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
      expect(serviceOfferingsService.findByIdOrThrow).not.toHaveBeenCalled();
      expect(prisma.outreachMessage.create).not.toHaveBeenCalled();
      expect(prisma.aIRequest.create).not.toHaveBeenCalled();
    });

    it('corta ANTES de gerar quando a organização estourou o orçamento — não persiste OutreachMessage, mas persiste um AIRequest BUDGET_EXCEEDED', async () => {
      const { service, prisma, gateway, leadsService, serviceOfferingsService, budgetService } = buildDeps();
      leadsService.findByIdOrThrow.mockResolvedValue(baseLead);
      serviceOfferingsService.findByIdOrThrow.mockResolvedValue(baseOffering);
      budgetService.isOverBudget.mockResolvedValue(true);

      await expect(
        service.generateDraft('org-1', 'lead-1', { channel: 'EMAIL' }, 'user-1'),
      ).rejects.toThrow(ForbiddenException);

      expect(gateway.sendMessage).not.toHaveBeenCalled();
      expect(prisma.outreachMessage.create).not.toHaveBeenCalled();
      expect(budgetService.recordSpend).not.toHaveBeenCalled();
      expect(prisma.aIRequest.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: 'org-1',
          userId: 'user-1',
          status: 'BUDGET_EXCEEDED',
          inputTokens: 0,
          outputTokens: 0,
          estimatedCost: 0,
        }),
      });
    });

    it('gateway falha: persiste um AIRequest ERROR e propaga o erro, sem persistir OutreachMessage', async () => {
      const { service, prisma, gateway, leadsService, serviceOfferingsService } = buildDeps();
      leadsService.findByIdOrThrow.mockResolvedValue(baseLead);
      serviceOfferingsService.findByIdOrThrow.mockResolvedValue(baseOffering);
      gateway.sendMessage.mockRejectedValue(new Error('gateway indisponível'));

      await expect(
        service.generateDraft('org-1', 'lead-1', { channel: 'EMAIL' }, 'user-1'),
      ).rejects.toThrow('gateway indisponível');

      expect(prisma.outreachMessage.create).not.toHaveBeenCalled();
      expect(prisma.aIRequest.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: 'org-1',
          userId: 'user-1',
          status: 'ERROR',
          errorMessage: 'gateway indisponível',
        }),
      });
    });
  });

  describe('máquina de estado completa (caminho válido)', () => {
    it('generate -> approve -> markSent -> markReplied avança status e atualiza Lead.status a cada passo', async () => {
      const { service, prisma, gateway, leadsService, serviceOfferingsService, auditService } = buildDeps();
      leadsService.findByIdOrThrow.mockResolvedValue(baseLead);
      serviceOfferingsService.findByIdOrThrow.mockResolvedValue(baseOffering);
      gateway.sendMessage.mockResolvedValue(mockGatewayResponse('rascunho'));

      const draft = { id: 'msg-1', leadId: 'lead-1', channel: 'EMAIL', serviceOfferingId: 'offering-1', status: 'DRAFT' };
      prisma.outreachMessage.create.mockResolvedValue(draft);
      const generated = await service.generateDraft('org-1', 'lead-1', { channel: 'EMAIL' }, 'user-1');
      expect(generated.status).toBe('DRAFT');

      // approve: DRAFT -> APPROVED
      const approved = { ...draft, status: 'APPROVED', approvedByUserId: 'user-1' };
      prisma.outreachMessage.findFirst
        .mockResolvedValueOnce(draft) // findByIdOrThrow (404 check)
        .mockResolvedValueOnce(approved); // refetch pós-updateMany dentro de applyTransition
      prisma.outreachMessage.updateMany.mockResolvedValueOnce({ count: 1 });
      const approveResult = await service.approve('org-1', 'msg-1', 'user-1');
      expect(approveResult.status).toBe('APPROVED');
      expect(prisma.outreachMessage.updateMany).toHaveBeenCalledWith({
        where: { id: 'msg-1', organizationId: 'org-1', status: 'DRAFT' },
        data: expect.objectContaining({ status: 'APPROVED', approvedByUserId: 'user-1' }),
      });
      expect(prisma.lead.update).toHaveBeenCalledWith({
        where: { id: 'lead-1' },
        data: { status: 'OUTREACH_APPROVED' },
      });
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ actorType: 'USER', actorId: 'user-1', action: 'outreach.approve' }),
      );

      // markSent: APPROVED -> SENT
      const sent = { ...approved, status: 'SENT' };
      prisma.outreachMessage.findFirst.mockResolvedValueOnce(approved).mockResolvedValueOnce(sent);
      prisma.outreachMessage.updateMany.mockResolvedValueOnce({ count: 1 });
      const sentResult = await service.markSent('org-1', 'msg-1', 'user-1');
      expect(sentResult.status).toBe('SENT');
      expect(prisma.outreachMessage.updateMany).toHaveBeenCalledWith({
        where: { id: 'msg-1', organizationId: 'org-1', status: 'APPROVED' },
        data: expect.objectContaining({ status: 'SENT' }),
      });
      expect(prisma.lead.update).toHaveBeenCalledWith({ where: { id: 'lead-1' }, data: { status: 'CONTACTED' } });

      // markReplied: SENT -> REPLIED
      const replied = { ...sent, status: 'REPLIED' };
      prisma.outreachMessage.findFirst.mockResolvedValueOnce(sent).mockResolvedValueOnce(replied);
      prisma.outreachMessage.updateMany.mockResolvedValueOnce({ count: 1 });
      const repliedResult = await service.markReplied('org-1', 'msg-1', 'user-1');
      expect(repliedResult.status).toBe('REPLIED');
      expect(prisma.outreachMessage.updateMany).toHaveBeenCalledWith({
        where: { id: 'msg-1', organizationId: 'org-1', status: 'SENT' },
        data: expect.objectContaining({ status: 'REPLIED' }),
      });
      expect(prisma.lead.update).toHaveBeenCalledWith({ where: { id: 'lead-1' }, data: { status: 'REPLIED' } });
    });
  });

  describe('transições inválidas', () => {
    it('markSent antes de approve (DRAFT) lança BadRequestException e não muda nada', async () => {
      const { service, prisma } = buildDeps();
      const draft = { id: 'msg-1', leadId: 'lead-1', status: 'DRAFT' };
      prisma.outreachMessage.findFirst.mockResolvedValueOnce(draft).mockResolvedValueOnce(draft);
      prisma.outreachMessage.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(service.markSent('org-1', 'msg-1', 'user-1')).rejects.toThrow(BadRequestException);
      expect(prisma.outreachMessage.updateMany).toHaveBeenCalledWith({
        where: { id: 'msg-1', organizationId: 'org-1', status: 'APPROVED' },
        data: expect.objectContaining({ status: 'SENT' }),
      });
      expect(prisma.lead.update).not.toHaveBeenCalled();
    });

    it('approve duas vezes: a segunda chamada (mensagem já APPROVED) lança BadRequestException', async () => {
      const { service, prisma } = buildDeps();
      const approved = { id: 'msg-1', leadId: 'lead-1', status: 'APPROVED' };
      prisma.outreachMessage.findFirst.mockResolvedValueOnce(approved).mockResolvedValueOnce(approved);
      prisma.outreachMessage.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(service.approve('org-1', 'msg-1', 'user-1')).rejects.toThrow(BadRequestException);
      expect(prisma.lead.update).not.toHaveBeenCalled();
    });

    it('reject depois de approve (mensagem APPROVED) lança BadRequestException', async () => {
      const { service, prisma } = buildDeps();
      const approved = { id: 'msg-1', leadId: 'lead-1', status: 'APPROVED' };
      prisma.outreachMessage.findFirst.mockResolvedValueOnce(approved).mockResolvedValueOnce(approved);
      prisma.outreachMessage.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(service.reject('org-1', 'msg-1', {}, 'user-1')).rejects.toThrow(BadRequestException);
    });

    it('markReplied antes de markSent (mensagem APPROVED) lança BadRequestException', async () => {
      const { service, prisma } = buildDeps();
      const approved = { id: 'msg-1', leadId: 'lead-1', status: 'APPROVED' };
      prisma.outreachMessage.findFirst.mockResolvedValueOnce(approved).mockResolvedValueOnce(approved);
      prisma.outreachMessage.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(service.markReplied('org-1', 'msg-1', 'user-1')).rejects.toThrow(BadRequestException);
      expect(prisma.lead.update).not.toHaveBeenCalled();
    });

    it('regenerate de uma mensagem já APPROVED lança BadRequestException (não pode "desaprovar" via regenerate)', async () => {
      const { service, prisma, leadsService } = buildDeps();
      const approved = { id: 'msg-1', leadId: 'lead-1', status: 'APPROVED' };
      prisma.outreachMessage.findFirst.mockResolvedValueOnce(approved).mockResolvedValueOnce(approved);
      prisma.outreachMessage.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(service.regenerate('org-1', 'msg-1', 'user-1')).rejects.toThrow(BadRequestException);
      // Nunca chega a gerar um novo rascunho.
      expect(leadsService.findByIdOrThrow).not.toHaveBeenCalled();
    });

    it('qualquer transição em uma mensagem inexistente lança NotFoundException', async () => {
      const { service, prisma } = buildDeps();
      prisma.outreachMessage.findFirst.mockResolvedValue(null);

      await expect(service.approve('org-1', 'missing', 'user-1')).rejects.toThrow(NotFoundException);
      expect(prisma.outreachMessage.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('condição de corrida (TOCTOU) — o status de origem entra no WHERE do UPDATE, não numa checagem em memória', () => {
    it('approve e reject concorrentes no mesmo DRAFT: quem commita por último no banco perde, nunca sobrescreve incondicionalmente', async () => {
      const { service, prisma, auditService } = buildDeps();
      const draft = { id: 'msg-1', leadId: 'lead-1', status: 'DRAFT' };

      // approve "vence a corrida": lê DRAFT, o UPDATE (com status=DRAFT no
      // WHERE) casa a linha porque, no banco real, ainda ninguém tinha
      // mudado o status.
      prisma.outreachMessage.findFirst
        .mockResolvedValueOnce(draft)
        .mockResolvedValueOnce({ ...draft, status: 'APPROVED' });
      prisma.outreachMessage.updateMany.mockResolvedValueOnce({ count: 1 });

      const approved = await service.approve('org-1', 'msg-1', 'user-1');
      expect(approved.status).toBe('APPROVED');

      // reject "perde a corrida": o que decide aqui é o UPDATE condicional
      // — simulado retornando count: 0, como o Postgres faria de fato já
      // que a linha real está em APPROVED.
      prisma.outreachMessage.findFirst
        .mockResolvedValueOnce({ ...draft, status: 'APPROVED' })
        .mockResolvedValueOnce({ ...draft, status: 'APPROVED' });
      prisma.outreachMessage.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(service.reject('org-1', 'msg-1', {}, 'user-2')).rejects.toThrow(BadRequestException);
      expect(prisma.outreachMessage.updateMany).toHaveBeenLastCalledWith({
        where: { id: 'msg-1', organizationId: 'org-1', status: 'DRAFT' },
        data: expect.objectContaining({ status: 'REJECTED' }),
      });
      // Nenhum audit log de reject foi gravado para a transição que perdeu.
      expect(auditService.log).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: 'outreach.reject' }),
      );
    });
  });

  describe('regenerate (caminho válido)', () => {
    it('marca a mensagem atual como REJECTED (reason "regenerated") e cria um novo DRAFT', async () => {
      const { service, prisma, gateway, leadsService, serviceOfferingsService, auditService } = buildDeps();
      const draft = { id: 'msg-1', leadId: 'lead-1', channel: 'EMAIL', serviceOfferingId: 'offering-1', status: 'DRAFT' };
      prisma.outreachMessage.findFirst
        .mockResolvedValueOnce(draft) // findByIdOrThrow
        .mockResolvedValueOnce({ ...draft, status: 'REJECTED', rejectedReason: 'regenerated' }); // refetch pós-updateMany
      prisma.outreachMessage.updateMany.mockResolvedValueOnce({ count: 1 });

      leadsService.findByIdOrThrow.mockResolvedValue(baseLead);
      serviceOfferingsService.findByIdOrThrow.mockResolvedValue(baseOffering);
      gateway.sendMessage.mockResolvedValue(mockGatewayResponse('novo rascunho'));
      const newDraft = { id: 'msg-2', status: 'DRAFT' };
      prisma.outreachMessage.create.mockResolvedValue(newDraft);

      const result = await service.regenerate('org-1', 'msg-1', 'user-1');

      expect(prisma.outreachMessage.updateMany).toHaveBeenCalledWith({
        where: { id: 'msg-1', organizationId: 'org-1', status: 'DRAFT' },
        data: { status: 'REJECTED', rejectedReason: 'regenerated' },
      });
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'outreach.regenerate', actorType: 'USER', actorId: 'user-1' }),
      );
      // generateDraft chamado de novo com o mesmo leadId/channel/serviceOfferingId
      expect(leadsService.findByIdOrThrow).toHaveBeenCalledWith('org-1', 'lead-1');
      expect(serviceOfferingsService.findByIdOrThrow).toHaveBeenCalledWith('org-1', 'offering-1');
      expect(result).toBe(newDraft);
    });
  });
});
