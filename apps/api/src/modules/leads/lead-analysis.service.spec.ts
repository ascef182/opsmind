import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { LeadAnalysisService } from './lead-analysis.service';
import type { AiGateway } from '../ai/gateway/ai-gateway.interface';

function buildDeps() {
  const prisma = {
    lead: { findFirst: jest.fn() },
    aIRequest: { create: jest.fn().mockResolvedValue({ id: 'ai-req-1' }) },
    leadEnrichment: { create: jest.fn() },
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

  const service = new LeadAnalysisService(
    prisma as never,
    gateway,
    budgetService as never,
    organizationsService as never,
    auditService as never,
  );

  return { service, prisma, gateway, budgetService, organizationsService, auditService };
}

const baseLead = {
  id: 'lead-1',
  organizationId: 'org-1',
  name: 'Padaria Central',
  address: 'Rua X',
  city: 'São Paulo',
  state: 'SP',
  googleCategory: 'Padaria',
  rating: 4.5,
  reviewCount: 20,
  website: null,
  score: 80,
  rawContent: null,
};

function mockGatewayResponse(text: string, inputTokens = 100, outputTokens = 50) {
  return {
    id: 'msg_1',
    stop_reason: 'end_turn',
    content: [{ type: 'text', text }],
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  } as never;
}

describe('LeadAnalysisService', () => {
  describe('analyzeLeadPotential', () => {
    it('lança 404 quando o lead não existe/não pertence à org', async () => {
      const { service, prisma } = buildDeps();
      prisma.lead.findFirst.mockResolvedValue(null);

      await expect(service.analyzeLeadPotential('org-1', 'missing', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('corta ANTES de chamar a IA quando o orçamento mensal foi atingido, mas persiste um AIRequest BUDGET_EXCEEDED', async () => {
      const { service, prisma, gateway, budgetService, auditService } = buildDeps();
      prisma.lead.findFirst.mockResolvedValue(baseLead);
      budgetService.isOverBudget.mockResolvedValue(true);

      await expect(service.analyzeLeadPotential('org-1', 'lead-1', 'user-1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(gateway.sendMessage).not.toHaveBeenCalled();
      expect(prisma.aIRequest.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ status: 'BUDGET_EXCEEDED', estimatedCost: 0 }),
      });
      expect(prisma.leadEnrichment.create).not.toHaveBeenCalled();
      expect(auditService.log).not.toHaveBeenCalled();
    });

    it('gera a análise, persiste AIRequest SUCCESS, grava LeadEnrichment{type: ai_analysis} (nunca mutando o Lead) e audita', async () => {
      const { service, prisma, gateway, budgetService, auditService } = buildDeps();
      prisma.lead.findFirst.mockResolvedValue(baseLead);
      gateway.sendMessage.mockResolvedValue(
        mockGatewayResponse('Este é um bom lead porque não tem site e tem boa avaliação.'),
      );
      const enrichment = { id: 'enr-1', type: 'ai_analysis' };
      prisma.leadEnrichment.create.mockResolvedValue(enrichment);

      const result = await service.analyzeLeadPotential('org-1', 'lead-1', 'user-1');

      expect(gateway.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ tools: [], messages: [{ role: 'user', content: expect.any(String) }] }),
      );
      expect(prisma.aIRequest.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ status: 'SUCCESS', inputTokens: 100, outputTokens: 50 }),
      });
      expect(prisma.leadEnrichment.create).toHaveBeenCalledWith({
        data: {
          organizationId: 'org-1',
          leadId: 'lead-1',
          type: 'ai_analysis',
          data: { text: 'Este é um bom lead porque não tem site e tem boa avaliação.' },
          actorType: 'AI',
          actorId: null,
        },
      });
      expect(budgetService.recordSpend).toHaveBeenCalledWith('org-1', expect.any(Number));
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          actorType: 'USER',
          actorId: 'user-1',
          organizationId: 'org-1',
          action: 'lead.analyzed',
          resource: 'Lead:lead-1',
          metadata: { leadEnrichmentId: 'enr-1' },
        }),
      );
      expect(result).toBe(enrichment);
    });

    it('gateway falha: persiste AIRequest ERROR e propaga o erro, sem gravar LeadEnrichment nem auditar', async () => {
      const { service, prisma, gateway, auditService } = buildDeps();
      prisma.lead.findFirst.mockResolvedValue(baseLead);
      gateway.sendMessage.mockRejectedValue(new Error('gateway indisponível'));

      await expect(service.analyzeLeadPotential('org-1', 'lead-1', 'user-1')).rejects.toThrow(
        'gateway indisponível',
      );
      expect(prisma.leadEnrichment.create).not.toHaveBeenCalled();
      expect(prisma.aIRequest.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ status: 'ERROR', errorMessage: 'gateway indisponível' }),
      });
      expect(auditService.log).not.toHaveBeenCalled();
    });
  });
});
