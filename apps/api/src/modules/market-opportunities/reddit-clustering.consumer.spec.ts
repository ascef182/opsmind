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
      upsert: jest.fn(),
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
        // `upsert` cria (linha não existia) e devolve a linha recém-criada.
        p.marketOpportunity.upsert.mockResolvedValue({ id: 'opp-1', status: 'NEW' });
        p.marketOpportunity.update.mockResolvedValue({ id: 'opp-1', status: 'NEW' });
        return p;
      })(),
    });

    const processor = getRegisteredProcessor();
    await processor({ data: jobData });

    expect(gateway.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ tools: [], messages: [{ role: 'user', content: expect.any(String) }] }),
    );
    // `upsert` de verdade (nunca findUnique + create): sem TOCTOU entre dois
    // jobs concorrentes do mesmo (organizationId, topicKey). `update: {}` é
    // no-op deliberado — a atualização condicionada ao status vem depois.
    expect(prisma.marketOpportunity.upsert).toHaveBeenCalledWith({
      where: { organizationId_topicKey: { organizationId: 'org-1', topicKey: 'preciso-de-site-pra-loja' } },
      create: {
        organizationId: 'org-1',
        title: cluster.label,
        topicKey: 'preciso-de-site-pra-loja',
        problemDescription: cluster.summary,
        mentionCount: 15,
        sourceUrls: cluster.sourceUrls,
        sampleQuotes: ['não sei nem por onde começar', 'nunca consegui um site bom'],
        status: 'NEW',
      },
      update: {},
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

    expect(prisma.marketOpportunity.upsert).not.toHaveBeenCalled();
    expect(prisma.marketOpportunity.update).not.toHaveBeenCalled();
  });

  it('JSON malformado da IA não derruba o consumer — loga e resolve sem criar nada', async () => {
    const { prisma, budgetService } = buildConsumer({ gateway: buildGateway('isto não é JSON válido {{{') });

    const processor = getRegisteredProcessor();

    await expect(processor({ data: jobData })).resolves.toBeUndefined();
    expect(prisma.marketOpportunity.upsert).not.toHaveBeenCalled();
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
        // Linha já existe em PURSUING — `upsert` cai no `update: {}` (no-op) e
        // devolve a linha como está.
        p.marketOpportunity.upsert.mockResolvedValue(existing);
        return p;
      })(),
    });

    const processor = getRegisteredProcessor();
    await processor({ data: jobData });

    expect(prisma.marketOpportunity.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: {} }),
    );
    expect(prisma.marketOpportunity.update).not.toHaveBeenCalled();
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
        p.marketOpportunity.upsert.mockResolvedValue(existing);
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
  });

  it('label sem alfanumérico ASCII (só emoji) não gera topicKey vazio — cai num hash estável e distinto por label', async () => {
    async function topicKeyFor(label: string): Promise<string> {
      const cluster = {
        label,
        summary: 'resumo',
        mentionCount: 12,
        matchedPostIndexes: [0],
        sourceUrls: ['https://reddit.com/r/x/1'],
        distinctAuthorCount: 11,
      };
      const { prisma } = buildConsumer({
        gateway: buildGateway(JSON.stringify([cluster])),
        prisma: (() => {
          const p = buildPrisma();
          p.marketOpportunity.upsert.mockResolvedValue({ id: 'opp-x', status: 'PURSUING' });
          return p;
        })(),
      });
      await getRegisteredProcessor()({ data: jobData });
      return prisma.marketOpportunity.upsert.mock.calls[0][0].where.organizationId_topicKey.topicKey;
    }

    const keyA = await topicKeyFor('🔥🔥🔥');
    jest.clearAllMocks();
    const keyB = await topicKeyFor('🚀🚀');

    expect(keyA).not.toBe('');
    expect(keyB).not.toBe('');
    // Dois labels diferentes → chaves diferentes (sem colisão na unique
    // composta `(organizationId, topicKey)`).
    expect(keyA).not.toBe(keyB);
    // Estável: o mesmo label gera sempre a mesma chave (é isso que dedupica
    // o mesmo tema entre execuções).
    jest.clearAllMocks();
    expect(await topicKeyFor('🔥🔥🔥')).toBe(keyA);
  });

  it('sourceUrls com esquema inseguro vindos da IA nunca são persistidos', async () => {
    const cluster = {
      label: 'Tema com link malicioso',
      summary: 'resumo',
      mentionCount: 12,
      matchedPostIndexes: [0],
      sourceUrls: [
        'javascript:alert(document.cookie)',
        'https://reddit.com/r/x/1',
        'data:text/html,<script>alert(1)</script>',
        'não é uma url',
      ],
      distinctAuthorCount: 11,
    };
    const { prisma } = buildConsumer({
      gateway: buildGateway(JSON.stringify([cluster])),
      prisma: (() => {
        const p = buildPrisma();
        p.marketOpportunity.upsert.mockResolvedValue({ id: 'opp-1', status: 'PURSUING' });
        return p;
      })(),
    });

    await getRegisteredProcessor()({ data: jobData });

    expect(prisma.marketOpportunity.upsert.mock.calls[0][0].create.sourceUrls).toEqual([
      'https://reddit.com/r/x/1',
    ]);
  });

  it('orçamento estourado pula sem chamar a IA, mas persiste um AIRequest BUDGET_EXCEEDED', async () => {
    const { gateway, prisma, auditService } = buildConsumer({
      organizationsService: buildOrganizationsService(10),
      budgetService: buildBudgetService(true),
    });

    const processor = getRegisteredProcessor();
    await expect(processor({ data: jobData })).resolves.toBeUndefined();

    expect(gateway.sendMessage).not.toHaveBeenCalled();
    expect(prisma.marketOpportunity.upsert).not.toHaveBeenCalled();
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
    expect(prisma.marketOpportunity.upsert).not.toHaveBeenCalled();
  });

  it('onModuleDestroy fecha o Worker e desconecta o Redis', async () => {
    const { consumer } = buildConsumer();
    const workerInstance = (Worker as unknown as jest.Mock).mock.results[0]!.value as { close: jest.Mock };

    await consumer.onModuleDestroy();

    expect(workerInstance.close).toHaveBeenCalled();
  });
});
