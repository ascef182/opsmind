jest.mock('./tenant-context', () => ({
  withTenantContext: jest.fn((_prisma: unknown, _orgId: string, fn: (tx: unknown) => unknown) => fn('TX')),
}));
jest.mock('./budget', () => ({
  isOverBudget: jest.fn(),
  recordSpend: jest.fn(),
}));

import { processLeadScrapeJob, normalizeUrlForDedup } from './lead-scrape-processor';
import { isOverBudget, recordSpend } from './budget';

describe('normalizeUrlForDedup', () => {
  it('normaliza protocolo, "www.", querystring/fragment e barra final como equivalentes', () => {
    const variants = [
      'https://www.exemplo.com.br/padaria/',
      'http://exemplo.com.br/padaria',
      'https://exemplo.com.br/padaria?utm_source=google',
      'https://WWW.EXEMPLO.com.br/Padaria#secao',
    ];
    const normalized = variants.map(normalizeUrlForDedup);
    expect(new Set(normalized).size).toBe(1);
  });

  it('devolve null quando não há URL nenhuma', () => {
    expect(normalizeUrlForDedup(null)).toBeNull();
    expect(normalizeUrlForDedup('')).toBeNull();
  });

  it('nunca lança em entrada não-parseável — cai no fallback best-effort', () => {
    expect(() => normalizeUrlForDedup('não é uma url')).not.toThrow();
  });
});

describe('processLeadScrapeJob', () => {
  const jobData = {
    organizationId: 'org-1',
    scrapeJobId: 'scrape-1',
    actorType: 'USER' as const,
    actorId: 'user-1',
  };

  const baseScrapeJob = {
    id: 'scrape-1',
    organizationId: 'org-1',
    sourceType: 'APIFY_GOOGLE_MAPS' as const,
    city: 'Campinas',
    state: 'SP',
    businessType: 'padaria',
    onlyWithoutWebsite: true,
    limit: 10,
    leadsFound: 0,
    status: 'RUNNING' as const,
  };

  function buildTx() {
    return {
      scrapeJob: { update: jest.fn() },
      serviceOffering: { findMany: jest.fn().mockResolvedValue([]) },
      lead: {
        upsert: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        update: jest.fn(),
      },
      leadEnrichment: { create: jest.fn() },
    };
  }

  function buildPrisma() {
    return {
      scrapeJob: {
        findFirstOrThrow: jest.fn(),
        update: jest.fn(),
      },
      organization: { findUniqueOrThrow: jest.fn() },
      auditLog: { create: jest.fn() },
    };
  }

  function setupTx() {
    const tx = buildTx();
    const { withTenantContext } = jest.requireMock('./tenant-context');
    withTenantContext.mockImplementation((_p: unknown, _o: string, fn: (tx: unknown) => unknown) => fn(tx));
    return tx;
  }

  function fakeGateways() {
    return {
      apify: { searchBusinesses: jest.fn() },
      explorium: { searchBusinesses: jest.fn(), matchBusiness: jest.fn() },
      camofox: { search: jest.fn() },
    };
  }

  const fakeRedis = { marker: 'redis' };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sucesso (Apify): filtra onlyWithoutWebsite, faz score/upsert, e registra COMPLETED + gasto', async () => {
    const tx = setupTx();
    (isOverBudget as jest.Mock).mockResolvedValue(false);
    const prisma = buildPrisma();
    prisma.scrapeJob.findFirstOrThrow.mockResolvedValue(baseScrapeJob);
    prisma.organization.findUniqueOrThrow.mockResolvedValue({ scrapingMonthlyBudget: null });
    tx.scrapeJob.update.mockResolvedValue({ ...baseScrapeJob, status: 'COMPLETED' });
    tx.lead.upsert.mockImplementation((args: { create: Record<string, unknown> }) =>
      Promise.resolve({ id: 'lead-1', ...args.create }),
    );

    const gateways = fakeGateways();
    gateways.apify.searchBusinesses.mockResolvedValue([
      {
        name: 'Padaria Sem Site',
        address: null,
        city: 'Campinas',
        state: 'SP',
        phone: null,
        website: null,
        googleCategory: 'Padaria',
        rating: 4.5,
        reviewCount: 20,
        placeId: 'place-1',
        raw: {},
      },
      {
        name: 'Padaria Com Site',
        address: null,
        city: 'Campinas',
        state: 'SP',
        phone: null,
        website: 'https://comsite.com',
        googleCategory: 'Padaria',
        rating: 4.0,
        reviewCount: 5,
        placeId: 'place-2',
        raw: {},
      },
    ]);
    gateways.explorium.matchBusiness.mockResolvedValue(null);

    const result = await processLeadScrapeJob(prisma as never, gateways as never, fakeRedis as never, jobData);

    expect(gateways.apify.searchBusinesses).toHaveBeenCalledWith({
      city: 'Campinas',
      state: 'SP',
      businessType: 'padaria',
      limit: 10,
    });
    // só o lead SEM site sobrevive ao filtro onlyWithoutWebsite
    expect(tx.lead.upsert).toHaveBeenCalledTimes(1);
    expect(tx.lead.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId_placeId: { organizationId: 'org-1', placeId: 'place-1' } },
        create: expect.objectContaining({ name: 'Padaria Sem Site', status: expect.any(String) }),
      }),
    );
    expect(gateways.explorium.matchBusiness).toHaveBeenCalledWith('Padaria Sem Site', null, null);
    expect(tx.scrapeJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'scrape-1' },
        data: expect.objectContaining({ status: 'COMPLETED', leadsFound: 1 }),
      }),
    );
    expect(recordSpend).toHaveBeenCalledWith(fakeRedis, 'org-1', expect.any(Number));
    expect(result.status).toBe('COMPLETED');
  });

  it('orçamento estourado: job falha sem chamar nenhum gateway nem gastar nada', async () => {
    const tx = setupTx();
    (isOverBudget as jest.Mock).mockResolvedValue(true);
    const prisma = buildPrisma();
    prisma.scrapeJob.findFirstOrThrow.mockResolvedValue(baseScrapeJob);
    prisma.organization.findUniqueOrThrow.mockResolvedValue({ scrapingMonthlyBudget: 10 });
    tx.scrapeJob.update.mockResolvedValue({ ...baseScrapeJob, status: 'FAILED' });

    const gateways = fakeGateways();

    const result = await processLeadScrapeJob(prisma as never, gateways as never, fakeRedis as never, jobData);

    expect(gateways.apify.searchBusinesses).not.toHaveBeenCalled();
    expect(gateways.explorium.searchBusinesses).not.toHaveBeenCalled();
    expect(gateways.camofox.search).not.toHaveBeenCalled();
    expect(tx.lead.upsert).not.toHaveBeenCalled();
    expect(recordSpend).not.toHaveBeenCalled();
    expect(tx.scrapeJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'FAILED',
          leadsFound: 0,
          errorMessage: expect.stringContaining('Orçamento'),
        }),
      }),
    );
    expect(result.status).toBe('FAILED');
  });

  it('erro de rede do gateway principal: job termina FAILED com mensagem clara, via prisma direto', async () => {
    setupTx();
    (isOverBudget as jest.Mock).mockResolvedValue(false);
    const prisma = buildPrisma();
    prisma.scrapeJob.findFirstOrThrow.mockResolvedValue(baseScrapeJob);
    prisma.organization.findUniqueOrThrow.mockResolvedValue({ scrapingMonthlyBudget: null });
    prisma.scrapeJob.update.mockResolvedValue({
      ...baseScrapeJob,
      status: 'FAILED',
      errorMessage: 'Falha de rede ao chamar Apify',
    });

    const gateways = fakeGateways();
    gateways.apify.searchBusinesses.mockRejectedValue(new Error('Falha de rede ao chamar Apify'));

    const result = await processLeadScrapeJob(prisma as never, gateways as never, fakeRedis as never, jobData);

    // FAILED é gravado via `prisma` direto (nunca dentro de uma tx já revertida).
    expect(prisma.scrapeJob.update).toHaveBeenCalledWith({
      where: { id: 'scrape-1' },
      data: expect.objectContaining({ status: 'FAILED', errorMessage: 'Falha de rede ao chamar Apify' }),
    });
    expect(recordSpend).not.toHaveBeenCalled();
    expect(result.status).toBe('FAILED');
  });

  it('erro de enrichment em 1 lead não derruba o job — só aquele lead fica sem firmographics', async () => {
    const tx = setupTx();
    (isOverBudget as jest.Mock).mockResolvedValue(false);
    const prisma = buildPrisma();
    prisma.scrapeJob.findFirstOrThrow.mockResolvedValue(baseScrapeJob);
    prisma.organization.findUniqueOrThrow.mockResolvedValue({ scrapingMonthlyBudget: null });
    tx.scrapeJob.update.mockResolvedValue({ ...baseScrapeJob, status: 'COMPLETED' });
    tx.lead.upsert.mockImplementation((args: { create: Record<string, unknown> }) =>
      Promise.resolve({ id: `lead-${args.create.placeId as string}`, ...args.create }),
    );

    const gateways = fakeGateways();
    gateways.apify.searchBusinesses.mockResolvedValue([
      {
        name: 'Padaria A',
        address: 'Rua A',
        city: 'Campinas',
        state: 'SP',
        phone: null,
        website: null,
        googleCategory: 'Padaria',
        rating: 4.5,
        reviewCount: 10,
        placeId: 'place-a',
        raw: {},
      },
      {
        name: 'Padaria B',
        address: 'Rua B',
        city: 'Campinas',
        state: 'SP',
        phone: null,
        website: null,
        googleCategory: 'Padaria',
        rating: 4.2,
        reviewCount: 8,
        placeId: 'place-b',
        raw: {},
      },
    ]);
    gateways.explorium.matchBusiness
      .mockRejectedValueOnce(new Error('Explorium indisponível'))
      .mockResolvedValueOnce({
        name: 'Padaria B',
        website: null,
        industry: 'Alimentação',
        employeeCount: 5,
        revenueUsd: 100_000,
        matchConfidence: 0.9,
        raw: {},
      });

    const result = await processLeadScrapeJob(prisma as never, gateways as never, fakeRedis as never, jobData);

    // Os DOIS leads são persistidos — a falha de enrichment do lead A não
    // impede o job de continuar processando o lead B nem de terminar OK.
    expect(tx.lead.upsert).toHaveBeenCalledTimes(2);
    // Só o lead B (enrichment bem-sucedido) ganha um LeadEnrichment.
    expect(tx.leadEnrichment.create).toHaveBeenCalledTimes(1);
    expect(tx.leadEnrichment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ leadId: 'lead-place-b', type: 'explorium_firmographics' }),
      }),
    );
    expect(tx.scrapeJob.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED', leadsFound: 2 }) }),
    );
    expect(result.status).toBe('COMPLETED');
  });

  it('Explorium: usa a firmografia já trazida pela própria busca, sem chamar matchBusiness de novo', async () => {
    const tx = setupTx();
    (isOverBudget as jest.Mock).mockResolvedValue(false);
    const prisma = buildPrisma();
    const exploriumJob = { ...baseScrapeJob, sourceType: 'EXPLORIUM_BUSINESS_SEARCH' as const };
    prisma.scrapeJob.findFirstOrThrow.mockResolvedValue(exploriumJob);
    prisma.organization.findUniqueOrThrow.mockResolvedValue({ scrapingMonthlyBudget: null });
    tx.scrapeJob.update.mockResolvedValue({ ...exploriumJob, status: 'COMPLETED' });
    // Leads da Explorium nunca têm `placeId` — passam pelo caminho de dedup
    // via findFirst (mock devolve null, ou seja "não existe ainda") +
    // create, não pelo `lead.upsert` de chave composta.
    tx.lead.create.mockImplementation((args: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'lead-1', ...args.data }),
    );

    const gateways = fakeGateways();
    gateways.explorium.searchBusinesses.mockResolvedValue([
      {
        name: 'Padaria Explorium',
        website: null,
        industry: 'Alimentação',
        employeeCount: 12,
        revenueUsd: 500_000,
        matchConfidence: 0.95,
        raw: {},
      },
    ]);

    const result = await processLeadScrapeJob(prisma as never, gateways as never, fakeRedis as never, jobData);

    // Firmografia vem direto do resultado de busca — NUNCA uma segunda
    // chamada de matchBusiness (que poderia falhar/não re-encontrar e
    // apagar um dado que a busca já tinha, ver comentário de
    // NEEDS_MATCH_ENRICHMENT).
    expect(gateways.explorium.matchBusiness).not.toHaveBeenCalled();
    expect(tx.leadEnrichment.create).toHaveBeenCalledTimes(1);
    expect(tx.leadEnrichment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'explorium_firmographics',
          data: expect.objectContaining({ employeeCount: 12, revenueUsd: 500_000 }),
        }),
      }),
    );
    expect(result.status).toBe('COMPLETED');
  });

  it('bookkeeping pós-conclusão (recordSpend) falhando NÃO reverte um job que já terminou com sucesso', async () => {
    const tx = setupTx();
    (isOverBudget as jest.Mock).mockResolvedValue(false);
    const prisma = buildPrisma();
    prisma.scrapeJob.findFirstOrThrow.mockResolvedValue(baseScrapeJob);
    prisma.organization.findUniqueOrThrow.mockResolvedValue({ scrapingMonthlyBudget: null });
    tx.scrapeJob.update.mockResolvedValue({ ...baseScrapeJob, status: 'COMPLETED', leadsFound: 1 });
    tx.lead.upsert.mockImplementation((args: { create: Record<string, unknown> }) =>
      Promise.resolve({ id: 'lead-1', ...args.create }),
    );
    (recordSpend as jest.Mock).mockRejectedValue(new Error('Redis indisponível'));

    const gateways = fakeGateways();
    gateways.apify.searchBusinesses.mockResolvedValue([
      {
        name: 'Padaria Sem Site',
        address: null,
        city: 'Campinas',
        state: 'SP',
        phone: null,
        website: null,
        googleCategory: 'Padaria',
        rating: 4.5,
        reviewCount: 20,
        placeId: 'place-1',
        raw: {},
      },
    ]);
    gateways.explorium.matchBusiness.mockResolvedValue(null);

    const result = await processLeadScrapeJob(prisma as never, gateways as never, fakeRedis as never, jobData);

    // O job já tinha sido commitado como COMPLETED (leads já salvos) ANTES
    // de recordSpend falhar — o `catch` externo NUNCA deve sobrescrever isso
    // pra FAILED (mentiria sobre o resultado real do job).
    expect(result.status).toBe('COMPLETED');
    // O `catch` externo (que grava via prisma.scrapeJob.update direto,
    // diferente do tx.scrapeJob.update usado no fluxo normal) nunca foi
    // acionado.
    expect(prisma.scrapeJob.update).not.toHaveBeenCalled();
    // AuditLog nunca chega a ser escrito neste cenário (recordSpend, que
    // vem antes dele em finalizeJob, já lançou) — mas isso não derruba o job.
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });
});
