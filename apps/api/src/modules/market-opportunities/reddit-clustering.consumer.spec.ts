jest.mock('bullmq', () => ({
  Worker: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  })),
}));
jest.mock('ioredis', () => jest.fn().mockImplementation(() => ({ disconnect: jest.fn() })));

import { Worker } from 'bullmq';
import type { RedditClusteringJobData } from '@opsmind/shared-types';
import { RedditClusteringConsumer } from './reddit-clustering.consumer';

function buildConfigService() {
  return { get: jest.fn().mockReturnValue('redis://localhost:6379') };
}

function buildPrisma() {
  return {
    marketOpportunity: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    aIRequest: {
      create: jest.fn().mockResolvedValue({ id: 'ai-req-1' }),
    },
  };
}

function buildAuditService() {
  return { log: jest.fn().mockResolvedValue(undefined) };
}

function buildOrganizationsService(aiMonthlyBudget: number | null = null) {
  return { findById: jest.fn().mockResolvedValue({ id: 'org-1', aiMonthlyBudget }) };
}

function buildBudgetService(isOverBudget = false) {
  return {
    isOverBudget: jest.fn().mockResolvedValue(isOverBudget),
    recordSpend: jest.fn().mockResolvedValue(undefined),
  };
}

function buildGateway(text: string) {
  return {
    sendMessage: jest.fn().mockResolvedValue({
      id: 'msg_1',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text }],
      usage: { input_tokens: 100, output_tokens: 50 },
    }),
  };
}

const jobData: RedditClusteringJobData = {
  organizationId: 'org-1',
  topicId: 'topic-1',
  topicQuery: 'preciso de um site pra minha loja',
  candidatePosts: [
    { url: 'https://reddit.com/r/x/1', title: 'post 1', textContent: 'não sei nem por onde começar' },
    { url: 'https://reddit.com/r/x/2', title: 'post 2', textContent: 'nunca consegui um site bom' },
  ],
};

function getRegisteredProcessor(): (job: { data: RedditClusteringJobData }) => Promise<void> {
  const call = (Worker as unknown as jest.Mock).mock.calls[0] as [string, (job: unknown) => Promise<void>];
  return call[1] as (job: { data: RedditClusteringJobData }) => Promise<void>;
}

function buildConsumer(opts: {
  prisma?: ReturnType<typeof buildPrisma>;
  auditService?: ReturnType<typeof buildAuditService>;
  organizationsService?: ReturnType<typeof buildOrganizationsService>;
  budgetService?: ReturnType<typeof buildBudgetService>;
  gateway?: ReturnType<typeof buildGateway>;
} = {}) {
  const prisma = opts.prisma ?? buildPrisma();
  const auditService = opts.auditService ?? buildAuditService();
  const organizationsService = opts.organizationsService ?? buildOrganizationsService();
  const budgetService = opts.budgetService ?? buildBudgetService();
  const gateway = opts.gateway ?? buildGateway('[]');

  const consumer = new RedditClusteringConsumer(
    buildConfigService() as never,
    prisma as never,
    auditService as never,
    organizationsService as never,
    budgetService as never,
    gateway as never,
  );
  consumer.onModuleInit();

  return { consumer, prisma, auditService, organizationsService, budgetService, gateway };
}

describe('RedditClusteringConsumer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('registra o Worker na fila "reddit-clustering" no onModuleInit', () => {
    buildConsumer();

    expect(Worker).toHaveBeenCalledWith('reddit-clustering', expect.any(Function), expect.anything());
  });

  it('cluster com distinctAuthorCount >= 10 cria uma MarketOpportunity NEW', async () => {
    const cluster = {
      label: 'Preciso de site pra loja',
      summary: 'Vários donos de pequenos negócios pedindo ajuda pra criar site',
      mentionCount: 15,
      matchedPostIndexes: [0, 1],
      sourceUrls: ['https://reddit.com/r/x/1', 'https://reddit.com/r/x/2'],
      distinctAuthorCount: 12,
    };
    const { prisma, auditService, budgetService, gateway } = buildConsumer({
      gateway: buildGateway(JSON.stringify([cluster])),
      prisma: (() => {
        const p = buildPrisma();
        p.marketOpportunity.findUnique.mockResolvedValue(null);
        p.marketOpportunity.create.mockResolvedValue({ id: 'opp-1' });
        return p;
      })(),
    });

    const processor = getRegisteredProcessor();
    await processor({ data: jobData });

    expect(gateway.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ tools: [], messages: [{ role: 'user', content: expect.any(String) }] }),
    );
    expect(prisma.marketOpportunity.findUnique).toHaveBeenCalledWith({
      where: { organizationId_topicKey: { organizationId: 'org-1', topicKey: 'preciso-de-site-pra-loja' } },
    });
    expect(prisma.marketOpportunity.create).toHaveBeenCalledWith({
      data: {
        organizationId: 'org-1',
        title: cluster.label,
        topicKey: 'preciso-de-site-pra-loja',
        problemDescription: cluster.summary,
        mentionCount: 15,
        sourceUrls: cluster.sourceUrls,
        sampleQuotes: ['não sei nem por onde começar', 'nunca consegui um site bom'],
        status: 'NEW',
      },
    });
    expect(budgetService.recordSpend).toHaveBeenCalledWith('org-1', expect.any(Number));
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ actorType: 'AI', action: 'market_opportunity.clustering_run' }),
    );
    expect(prisma.aIRequest.create).toHaveBeenCalledWith({
      data: {
        organizationId: 'org-1',
        userId: null,
        actorType: 'AI',
        actorId: null,
        model: 'claude-opus-5',
        inputTokens: 100,
        outputTokens: 50,
        latencyMs: expect.any(Number),
        estimatedCost: expect.any(Number),
        status: 'SUCCESS',
        errorMessage: undefined,
      },
    });
  });

  it('cluster com distinctAuthorCount < 10 (mesmo com mentionCount alto, um autor só) não cria nada', async () => {
    const cluster = {
      label: 'Mesmo autor postando muito',
      summary: 'Um único usuário reclamando repetidamente',
      mentionCount: 20,
      matchedPostIndexes: [0, 1],
      sourceUrls: ['https://reddit.com/r/x/1', 'https://reddit.com/r/x/2'],
      distinctAuthorCount: 1,
    };
    const { prisma } = buildConsumer({ gateway: buildGateway(JSON.stringify([cluster])) });

    const processor = getRegisteredProcessor();
    await processor({ data: jobData });

    expect(prisma.marketOpportunity.findUnique).not.toHaveBeenCalled();
    expect(prisma.marketOpportunity.create).not.toHaveBeenCalled();
    expect(prisma.marketOpportunity.update).not.toHaveBeenCalled();
  });

  it('JSON malformado da IA não derruba o consumer — loga e resolve sem criar nada', async () => {
    const { prisma, budgetService } = buildConsumer({ gateway: buildGateway('isto não é JSON válido {{{') });

    const processor = getRegisteredProcessor();

    await expect(processor({ data: jobData })).resolves.toBeUndefined();
    expect(prisma.marketOpportunity.create).not.toHaveBeenCalled();
    // Gasto real com a IA ainda é registrado — a chamada aconteceu.
    expect(budgetService.recordSpend).toHaveBeenCalledWith('org-1', expect.any(Number));
    // A chamada à IA teve sucesso (só o parse do JSON falhou depois) — o
    // AIRequest gravado reflete isso: SUCCESS, não ERROR.
    expect(prisma.aIRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'SUCCESS' }) }),
    );
  });

  it('registro PURSUING existente não é sobrescrito por um novo resultado do mesmo topicKey', async () => {
    const cluster = {
      label: 'Preciso de site pra loja',
      summary: 'Novo resumo diferente do original',
      mentionCount: 99,
      matchedPostIndexes: [0, 1],
      sourceUrls: ['https://reddit.com/r/x/new'],
      distinctAuthorCount: 15,
    };
    const existing = {
      id: 'opp-1',
      organizationId: 'org-1',
      topicKey: 'preciso-de-site-pra-loja',
      status: 'PURSUING',
      mentionCount: 15,
      sourceUrls: ['https://reddit.com/r/x/1'],
      sampleQuotes: ['quote original'],
    };
    const { prisma } = buildConsumer({
      gateway: buildGateway(JSON.stringify([cluster])),
      prisma: (() => {
        const p = buildPrisma();
        p.marketOpportunity.findUnique.mockResolvedValue(existing);
        return p;
      })(),
    });

    const processor = getRegisteredProcessor();
    await processor({ data: jobData });

    expect(prisma.marketOpportunity.update).not.toHaveBeenCalled();
    expect(prisma.marketOpportunity.create).not.toHaveBeenCalled();
  });

  it('registro NEW/REVIEWING existente é atualizado (mentionCount/sourceUrls/sampleQuotes), nunca o status', async () => {
    const cluster = {
      label: 'Preciso de site pra loja',
      summary: 'Novo resumo',
      mentionCount: 30,
      matchedPostIndexes: [0],
      sourceUrls: ['https://reddit.com/r/x/1'],
      distinctAuthorCount: 11,
    };
    const existing = {
      id: 'opp-1',
      organizationId: 'org-1',
      topicKey: 'preciso-de-site-pra-loja',
      status: 'REVIEWING',
    };
    const { prisma } = buildConsumer({
      gateway: buildGateway(JSON.stringify([cluster])),
      prisma: (() => {
        const p = buildPrisma();
        p.marketOpportunity.findUnique.mockResolvedValue(existing);
        p.marketOpportunity.update.mockResolvedValue({ ...existing, mentionCount: 30 });
        return p;
      })(),
    });

    const processor = getRegisteredProcessor();
    await processor({ data: jobData });

    expect(prisma.marketOpportunity.update).toHaveBeenCalledWith({
      where: { id: 'opp-1' },
      data: {
        mentionCount: 30,
        sourceUrls: cluster.sourceUrls,
        sampleQuotes: ['não sei nem por onde começar'],
      },
    });
    expect(prisma.marketOpportunity.create).not.toHaveBeenCalled();
  });

  it('orçamento estourado pula sem chamar a IA, mas persiste um AIRequest BUDGET_EXCEEDED', async () => {
    const { gateway, prisma, auditService } = buildConsumer({
      organizationsService: buildOrganizationsService(10),
      budgetService: buildBudgetService(true),
    });

    const processor = getRegisteredProcessor();
    await expect(processor({ data: jobData })).resolves.toBeUndefined();

    expect(gateway.sendMessage).not.toHaveBeenCalled();
    expect(prisma.marketOpportunity.create).not.toHaveBeenCalled();
    expect(auditService.log).not.toHaveBeenCalled();
    expect(prisma.aIRequest.create).toHaveBeenCalledWith({
      data: {
        organizationId: 'org-1',
        userId: null,
        actorType: 'AI',
        actorId: null,
        model: 'claude-opus-5',
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: 0,
        estimatedCost: 0,
        status: 'BUDGET_EXCEEDED',
        errorMessage: undefined,
      },
    });
  });

  it('erro na chamada à IA persiste um AIRequest ERROR e relança (deixa o BullMQ retentar)', async () => {
    const gatewayError = new Error('Falha de rede ao chamar o gateway de IA');
    const gateway = { sendMessage: jest.fn().mockRejectedValue(gatewayError) };
    const { prisma } = buildConsumer({ gateway });

    const processor = getRegisteredProcessor();

    await expect(processor({ data: jobData })).rejects.toThrow('Falha de rede ao chamar o gateway de IA');
    expect(prisma.aIRequest.create).toHaveBeenCalledWith({
      data: {
        organizationId: 'org-1',
        userId: null,
        actorType: 'AI',
        actorId: null,
        model: 'claude-opus-5',
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: expect.any(Number),
        estimatedCost: 0,
        status: 'ERROR',
        errorMessage: 'Falha de rede ao chamar o gateway de IA',
      },
    });
    expect(prisma.marketOpportunity.create).not.toHaveBeenCalled();
  });

  it('onModuleDestroy fecha o Worker e desconecta o Redis', async () => {
    const { consumer } = buildConsumer();
    const workerInstance = (Worker as unknown as jest.Mock).mock.results[0]!.value as { close: jest.Mock };

    await consumer.onModuleDestroy();

    expect(workerInstance.close).toHaveBeenCalled();
  });
});
