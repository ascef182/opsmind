import { scanRedditMiningTopics } from './reddit-mining-scan';
import { recordSpend } from './budget';

jest.mock('./budget', () => ({
  ...jest.requireActual('./budget'),
  recordSpend: jest.fn(),
}));

describe('scanRedditMiningTopics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (recordSpend as jest.Mock).mockResolvedValue(undefined);
  });

  function buildPrisma() {
    return {
      redditWatchTopic: { findMany: jest.fn() },
    };
  }

  function buildCamofox() {
    return {
      search: jest.fn(),
    };
  }

  // `isOverBudget` (não mockado — usa o `budget.ts` real) lê o gasto do mês
  // via `redis.get`; `spend` aqui é o valor que essa chave devolve.
  function buildRedis(spend: string | null = null) {
    return {
      get: jest.fn().mockResolvedValue(spend),
    };
  }

  function buildTopic(overrides: Record<string, unknown> = {}) {
    return {
      id: 'topic-1',
      organizationId: 'org-1',
      query: 'ferramenta de CRM',
      subreddit: null,
      isActive: true,
      organization: { scrapingMonthlyBudget: null },
      ...overrides,
    };
  }

  it('enfileira 1 job com os posts certos para um tópico ativo com resultados', async () => {
    const prisma = buildPrisma();
    const camofox = buildCamofox();
    prisma.redditWatchTopic.findMany.mockResolvedValue([buildTopic()]);
    camofox.search.mockResolvedValue([
      { title: 'Post 1', url: 'https://reddit.com/r/x/1', textContent: 'texto 1', raw: {} },
      { title: 'Post 2', url: 'https://reddit.com/r/x/2', textContent: null, raw: {} },
    ]);
    const enqueue = jest.fn();

    const count = await scanRedditMiningTopics(prisma as never, camofox as never, buildRedis() as never, enqueue);

    expect(prisma.redditWatchTopic.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      include: { organization: true },
    });
    expect(camofox.search).toHaveBeenCalledWith({
      macro: '@reddit_search',
      query: 'ferramenta de CRM',
      limit: 25,
    });
    expect(enqueue).toHaveBeenCalledWith({
      organizationId: 'org-1',
      topicId: 'topic-1',
      topicQuery: 'ferramenta de CRM',
      candidatePosts: [
        { url: 'https://reddit.com/r/x/1', title: 'Post 1', textContent: 'texto 1' },
        { url: 'https://reddit.com/r/x/2', title: 'Post 2', textContent: null },
      ],
    });
    expect(count).toBe(1);
  });

  it('monta a query com subreddit quando o tópico define um', async () => {
    const prisma = buildPrisma();
    const camofox = buildCamofox();
    prisma.redditWatchTopic.findMany.mockResolvedValue([
      buildTopic({ subreddit: 'smallbusiness', query: 'preciso de um CRM' }),
    ]);
    camofox.search.mockResolvedValue([
      { title: 'Post', url: 'https://reddit.com/r/smallbusiness/1', textContent: null, raw: {} },
    ]);
    const enqueue = jest.fn();

    await scanRedditMiningTopics(prisma as never, camofox as never, buildRedis() as never, enqueue);

    expect(camofox.search).toHaveBeenCalledWith({
      macro: '@reddit_search',
      query: 'subreddit:smallbusiness preciso de um CRM',
      limit: 25,
    });
  });

  it('não enfileira e não lança quando a busca devolve resultado vazio', async () => {
    const prisma = buildPrisma();
    const camofox = buildCamofox();
    prisma.redditWatchTopic.findMany.mockResolvedValue([buildTopic()]);
    camofox.search.mockResolvedValue([]);
    const enqueue = jest.fn();

    const count = await scanRedditMiningTopics(prisma as never, camofox as never, buildRedis() as never, enqueue);

    expect(enqueue).not.toHaveBeenCalled();
    expect(count).toBe(0);
  });

  it('captura erro do Camoufox sem derrubar o scan dos outros tópicos', async () => {
    const prisma = buildPrisma();
    const camofox = buildCamofox();
    prisma.redditWatchTopic.findMany.mockResolvedValue([
      buildTopic({ id: 'topic-broken', organizationId: 'org-1' }),
      buildTopic({ id: 'topic-ok', organizationId: 'org-2' }),
    ]);
    camofox.search
      .mockRejectedValueOnce(new Error('camofox indisponível'))
      .mockResolvedValueOnce([
        { title: 'Post', url: 'https://reddit.com/r/x/1', textContent: null, raw: {} },
      ]);
    const enqueue = jest.fn();

    const count = await scanRedditMiningTopics(prisma as never, camofox as never, buildRedis() as never, enqueue);

    expect(count).toBe(1);
    expect(camofox.search).toHaveBeenCalledTimes(2);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ topicId: 'topic-ok', organizationId: 'org-2' }),
    );
  });

  it('orçamento de scraping estourado: pula o tópico SEM chamar o Camoufox e sem gastar', async () => {
    const prisma = buildPrisma();
    const camofox = buildCamofox();
    prisma.redditWatchTopic.findMany.mockResolvedValue([
      buildTopic({ organization: { scrapingMonthlyBudget: 10 } }),
    ]);
    // Gasto do mês (12) já acima do teto (10) → `isOverBudget` corta.
    const redis = buildRedis('12');
    const enqueue = jest.fn();

    const count = await scanRedditMiningTopics(prisma as never, camofox as never, redis as never, enqueue);

    expect(camofox.search).not.toHaveBeenCalled();
    expect(recordSpend).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
    expect(count).toBe(0);
  });

  it('orçamento dentro do teto: busca normalmente e registra o gasto da chamada', async () => {
    const prisma = buildPrisma();
    const camofox = buildCamofox();
    prisma.redditWatchTopic.findMany.mockResolvedValue([
      buildTopic({ organization: { scrapingMonthlyBudget: 10 } }),
    ]);
    const redis = buildRedis('2');
    camofox.search.mockResolvedValue([
      { title: 'Post', url: 'https://reddit.com/r/x/1', textContent: null, raw: {} },
    ]);

    const count = await scanRedditMiningTopics(prisma as never, camofox as never, redis as never, jest.fn());

    expect(camofox.search).toHaveBeenCalledTimes(1);
    expect(recordSpend).toHaveBeenCalledWith(redis, 'org-1', 0.001);
    expect(count).toBe(1);
  });

  it('busca vazia também registra o gasto — a chamada custou mesmo sem resultado', async () => {
    const prisma = buildPrisma();
    const camofox = buildCamofox();
    prisma.redditWatchTopic.findMany.mockResolvedValue([buildTopic()]);
    camofox.search.mockResolvedValue([]);

    await scanRedditMiningTopics(prisma as never, camofox as never, buildRedis() as never, jest.fn());

    expect(recordSpend).toHaveBeenCalledTimes(1);
  });

  it('descarta posts cuja URL não é http/https antes de enfileirar (XSS armazenado)', async () => {
    const prisma = buildPrisma();
    const camofox = buildCamofox();
    prisma.redditWatchTopic.findMany.mockResolvedValue([buildTopic()]);
    camofox.search.mockResolvedValue([
      { title: 'Malicioso', url: 'javascript:alert(1)//reddit.com', textContent: 'x', raw: {} },
      { title: 'OK', url: 'https://reddit.com/r/x/1', textContent: 'y', raw: {} },
    ]);
    const enqueue = jest.fn();

    await scanRedditMiningTopics(prisma as never, camofox as never, buildRedis() as never, enqueue);

    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        candidatePosts: [{ url: 'https://reddit.com/r/x/1', title: 'OK', textContent: 'y' }],
      }),
    );
  });

  it('nenhuma URL utilizável (todas com esquema inseguro): não enfileira nada', async () => {
    const prisma = buildPrisma();
    const camofox = buildCamofox();
    prisma.redditWatchTopic.findMany.mockResolvedValue([buildTopic()]);
    camofox.search.mockResolvedValue([
      { title: 'Malicioso', url: 'javascript:alert(1)', textContent: 'x', raw: {} },
    ]);
    const enqueue = jest.fn();

    const count = await scanRedditMiningTopics(prisma as never, camofox as never, buildRedis() as never, enqueue);

    expect(enqueue).not.toHaveBeenCalled();
    expect(count).toBe(0);
  });

  it('nunca considera RedditWatchTopics com isActive: false (filtrado na própria query)', async () => {
    const prisma = buildPrisma();
    const camofox = buildCamofox();
    // A query real já filtra isActive: true — um tópico inativo nunca chega
    // a ser retornado pelo Prisma, então o mock devolve a lista vazia.
    prisma.redditWatchTopic.findMany.mockResolvedValue([]);

    const count = await scanRedditMiningTopics(prisma as never, camofox as never, buildRedis() as never, jest.fn());

    expect(prisma.redditWatchTopic.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true } }),
    );
    expect(camofox.search).not.toHaveBeenCalled();
    expect(count).toBe(0);
  });
});
