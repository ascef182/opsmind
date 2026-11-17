import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DealProposalService } from './deal-proposal.service';
import type { AiGateway } from '../ai/gateway/ai-gateway.interface';
import { AiOneShotRunner } from '../ai/services/ai-one-shot-runner';

function mockGatewayResponse(
  text: string,
  inputTokens = 100,
  outputTokens = 50,
  model = 'claude-opus-5',
) {
  return {
    id: 'msg_1',
    model,
    stop_reason: 'end_turn',
    content: [{ type: 'text', text }],
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  } as never;
}

function buildDeps() {
  const prisma = {
    deal: { update: jest.fn() },
    customer: { findFirst: jest.fn() },
    aIRequest: { create: jest.fn().mockResolvedValue({ id: 'ai-req-1' }) },
    costEvent: { create: jest.fn() },
  };
  const prismaOutOfBand = {
    runOutsideTransaction: jest.fn((_organizationId: string, fn: (tx: typeof prisma) => unknown) => fn(prisma)),
  };
  const gateway: jest.Mocked<AiGateway> = { sendMessage: jest.fn() };
  const budgetService = {
    isOverBudget: jest.fn().mockResolvedValue(false),
    recordSpend: jest.fn().mockResolvedValue(undefined),
  };
  const organizationsService = { findById: jest.fn().mockResolvedValue({ id: 'org-1', aiMonthlyBudget: null }) };
  const auditService = { log: jest.fn().mockResolvedValue(undefined) };
  const dealsService = { findByIdOrThrow: jest.fn() };

  const aiRunner = new AiOneShotRunner(prismaOutOfBand as never, gateway, budgetService as never);
  const service = new DealProposalService(
    prisma as never,
    aiRunner,
    organizationsService as never,
    auditService as never,
    dealsService as never,
  );

  return { service, prisma, gateway, budgetService, organizationsService, auditService, dealsService };
}

const baseDeal = {
  id: 'deal-1',
  organizationId: 'org-1',
  customerId: 'cust-1',
  title: 'Contrato de manutenção',
  value: { toString: () => '5000' },
  currency: 'BRL',
  expectedCloseDate: null,
};

const baseCustomer = { id: 'cust-1', organizationId: 'org-1', name: 'Acme Ltda', company: 'Acme' };

describe('DealProposalService.generate', () => {
  it('gera a proposta, persiste o AIRequest, grava proposalDraft/proposalGeneratedAt e audita', async () => {
    const { service, prisma, gateway, dealsService, auditService } = buildDeps();
    dealsService.findByIdOrThrow.mockResolvedValue(baseDeal);
    prisma.customer.findFirst.mockResolvedValue(baseCustomer);
    gateway.sendMessage.mockResolvedValue(mockGatewayResponse('Minuta de proposta...'));
    prisma.deal.update.mockResolvedValue({ ...baseDeal, proposalDraft: 'Minuta de proposta...' });

    const result = await service.generate('org-1', 'deal-1', 'user-1');

    expect(prisma.deal.update).toHaveBeenCalledWith({
      where: { id: 'deal-1' },
      data: { proposalDraft: 'Minuta de proposta...', proposalGeneratedAt: expect.any(Date) },
    });
    expect(prisma.aIRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ organizationId: 'org-1', userId: 'user-1', status: 'SUCCESS' }),
      }),
    );
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'deal.proposal_generated', resource: 'Deal:deal-1' }),
    );
    expect(result.proposalDraft).toBe('Minuta de proposta...');
  });

  it('grava o AIRequest com o modelo que a API de fato respondeu, não uma constante fixa', async () => {
    const { service, prisma, gateway, dealsService } = buildDeps();
    dealsService.findByIdOrThrow.mockResolvedValue(baseDeal);
    prisma.customer.findFirst.mockResolvedValue(baseCustomer);
    gateway.sendMessage.mockResolvedValue(
      mockGatewayResponse('ok', 1_000_000, 1_000_000, 'claude-sonnet-5'),
    );
    prisma.deal.update.mockResolvedValue({ ...baseDeal, proposalDraft: 'ok' });

    await service.generate('org-1', 'deal-1', 'user-1');

    expect(prisma.aIRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ model: 'claude-sonnet-5', estimatedCost: 12 }),
      }),
    );
  });

  it('debita o custo da proposta no orçamento e grava a linha na razão de custos (antes não debitava)', async () => {
    const { service, prisma, gateway, dealsService, budgetService } = buildDeps();
    dealsService.findByIdOrThrow.mockResolvedValue(baseDeal);
    prisma.customer.findFirst.mockResolvedValue(baseCustomer);
    gateway.sendMessage.mockResolvedValue(mockGatewayResponse('ok', 1_000_000, 1_000_000, 'claude-sonnet-5'));
    prisma.deal.update.mockResolvedValue({ ...baseDeal, proposalDraft: 'ok' });

    await service.generate('org-1', 'deal-1', 'user-1');

    expect(budgetService.recordSpend).toHaveBeenCalledWith('org-1', 12);
    expect(gateway.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ tier: 'standard' }));
    expect(prisma.costEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        category: 'AI',
        operation: 'deal.proposal',
        dealId: 'deal-1',
        aiRequestId: 'ai-req-1',
        amountUsd: 12,
      }),
    });
  });

  it('rejeita quando o cliente vinculado não é encontrado (soft-deletado ou de outra org)', async () => {
    const { service, dealsService, prisma, gateway } = buildDeps();
    dealsService.findByIdOrThrow.mockResolvedValue(baseDeal);
    prisma.customer.findFirst.mockResolvedValue(null);

    await expect(service.generate('org-1', 'deal-1', 'user-1')).rejects.toThrow(BadRequestException);
    expect(gateway.sendMessage).not.toHaveBeenCalled();
  });

  it('corta ANTES de gerar quando a organização estourou o orçamento — persiste AIRequest BUDGET_EXCEEDED, nunca chama o gateway', async () => {
    const { service, dealsService, prisma, gateway, budgetService } = buildDeps();
    dealsService.findByIdOrThrow.mockResolvedValue(baseDeal);
    prisma.customer.findFirst.mockResolvedValue(baseCustomer);
    budgetService.isOverBudget.mockResolvedValue(true);

    await expect(service.generate('org-1', 'deal-1', 'user-1')).rejects.toThrow(ForbiddenException);
    expect(gateway.sendMessage).not.toHaveBeenCalled();
    expect(prisma.aIRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'BUDGET_EXCEEDED' }) }),
    );
    expect(prisma.deal.update).not.toHaveBeenCalled();
  });

  it('gateway falha: persiste AIRequest ERROR e propaga o erro, sem gravar proposalDraft', async () => {
    const { service, dealsService, prisma, gateway } = buildDeps();
    dealsService.findByIdOrThrow.mockResolvedValue(baseDeal);
    prisma.customer.findFirst.mockResolvedValue(baseCustomer);
    gateway.sendMessage.mockRejectedValue(new Error('timeout'));

    await expect(service.generate('org-1', 'deal-1', 'user-1')).rejects.toThrow('timeout');
    expect(prisma.aIRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'ERROR', errorMessage: 'timeout' }) }),
    );
    expect(prisma.deal.update).not.toHaveBeenCalled();
  });
});

describe('DealProposalService.downloadPdf', () => {
  it('renderiza a proposalDraft já gerada como PDF (bytes começam com %PDF)', async () => {
    const { service, dealsService, prisma } = buildDeps();
    dealsService.findByIdOrThrow.mockResolvedValue({
      ...baseDeal,
      proposalDraft: 'Minuta de proposta...',
      proposalGeneratedAt: new Date('2026-09-20T10:00:00Z'),
    });
    prisma.customer.findFirst.mockResolvedValue(baseCustomer);

    const buffer = await service.downloadPdf('org-1', 'deal-1');

    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('rejeita quando nenhuma proposta foi gerada ainda (proposalDraft null)', async () => {
    const { service, dealsService, prisma } = buildDeps();
    dealsService.findByIdOrThrow.mockResolvedValue({ ...baseDeal, proposalDraft: null });
    prisma.customer.findFirst.mockResolvedValue(baseCustomer);

    await expect(service.downloadPdf('org-1', 'deal-1')).rejects.toThrow(BadRequestException);
  });

  it('rejeita quando o cliente vinculado não é encontrado', async () => {
    const { service, dealsService, prisma } = buildDeps();
    dealsService.findByIdOrThrow.mockResolvedValue({ ...baseDeal, proposalDraft: 'Minuta...' });
    prisma.customer.findFirst.mockResolvedValue(null);

    await expect(service.downloadPdf('org-1', 'deal-1')).rejects.toThrow(BadRequestException);
  });
});
