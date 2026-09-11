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
      // Usado pelo pré-fetch batched de `whatsapp`/`socialLinks` já
      // existentes (Task 9, ver `prefetchExistingContactState`) — default
      // "nenhum lead existente encontrado", testes que não são sobre esse
      // pré-fetch não precisam mockar isto.
      lead: { findMany: jest.fn().mockResolvedValue([]) },
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
      // Defaults "não achou nada de novo" — mesmo espírito dos outros
      // gateways acima: testes que não são sobre contato/redes não
      // precisam se preocupar em mockar isto, e o passo de descoberta cai
      // silenciosamente pro fallback (sem `whatsapp`/`socialLinks`) sem
      // afetar nenhuma asserção pré-existente.
      camofox: { search: jest.fn().mockResolvedValue([]) },
      contactEnrichment: {
        scrapeContactInfo: jest.fn().mockResolvedValue({ emails: [], phones: [], socials: [] }),
        lookupInstagramProfile: jest.fn().mockResolvedValue(null),
      },
    };
  }

  const fakeRedis = { marker: 'redis' };

  beforeEach(() => {
    jest.clearAllMocks();
    // `clearAllMocks()` só limpa histórico de chamadas — NÃO desfaz um
    // `mockRejectedValue`/`mockResolvedValue` já configurado em um teste
    // anterior (isso é `resetAllMocks()`, que não usamos aqui porque
    // quebraria o default de `withTenantContext` configurado via
    // `setupTx()` dentro de cada teste). Sem este reset explícito, o
    // `recordSpend.mockRejectedValue(...)` do teste de bookkeeping (mais
    // abaixo) vazaria pros testes seguintes que também chamam `recordSpend`.
    (recordSpend as jest.Mock).mockResolvedValue(undefined);
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

  describe('descoberta de contato/redes (Task 9)', () => {
    // `onlyWithoutWebsite: false` — diferente de `baseScrapeJob`, precisamos
    // que um candidato COM `website` sobreviva ao filtro pra exercitar o
    // caminho primário (que só roda quando `candidate.website` existe).
    const contactJob = { ...baseScrapeJob, onlyWithoutWebsite: false };

    function apifyCandidateWithWebsite(overrides: Record<string, unknown> = {}) {
      return {
        name: 'Padaria Contato',
        address: 'Rua X',
        city: 'Campinas',
        state: 'SP',
        phone: null,
        website: 'https://padariacontato.com.br',
        googleCategory: 'Padaria',
        rating: 4.5,
        reviewCount: 10,
        placeId: 'place-contato',
        raw: {},
        ...overrides,
      };
    }

    it('(a) caminho primário: ContactEnrichmentGateway acha dados → whatsapp/email/socialLinks populados + LeadEnrichment{source:"apify_actor"}', async () => {
      const tx = setupTx();
      (isOverBudget as jest.Mock).mockResolvedValue(false);
      const prisma = buildPrisma();
      prisma.scrapeJob.findFirstOrThrow.mockResolvedValue(contactJob);
      prisma.organization.findUniqueOrThrow.mockResolvedValue({ scrapingMonthlyBudget: null });
      tx.scrapeJob.update.mockResolvedValue({ ...contactJob, status: 'COMPLETED' });
      tx.lead.upsert.mockImplementation((args: { create: Record<string, unknown> }) =>
        Promise.resolve({ id: 'lead-contato', ...args.create }),
      );

      const gateways = fakeGateways();
      gateways.apify.searchBusinesses.mockResolvedValue([apifyCandidateWithWebsite()]);
      gateways.explorium.matchBusiness.mockResolvedValue(null);
      gateways.contactEnrichment.scrapeContactInfo.mockResolvedValue({
        emails: ['contato@padariacontato.com.br'],
        phones: [],
        socials: [
          { platform: 'WHATSAPP', url: 'https://wa.me/5519912345678' },
          { platform: 'INSTAGRAM', url: 'https://instagram.com/padariacontato' },
        ],
      });
      gateways.contactEnrichment.lookupInstagramProfile.mockResolvedValue({
        bio: 'Padaria artesanal',
        whatsappLink: null,
        email: null,
      });

      const result = await processLeadScrapeJob(prisma as never, gateways as never, fakeRedis as never, jobData);

      expect(gateways.contactEnrichment.scrapeContactInfo).toHaveBeenCalledWith('https://padariacontato.com.br');
      // Achou um social INSTAGRAM entre os `socials` devolvidos → chama o lookup de perfil.
      expect(gateways.contactEnrichment.lookupInstagramProfile).toHaveBeenCalledWith('padariacontato');
      expect(gateways.camofox.search).not.toHaveBeenCalled();
      expect(tx.lead.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            whatsapp: 'https://wa.me/5519912345678',
            email: 'contato@padariacontato.com.br',
            socialLinks: expect.arrayContaining([
              { platform: 'WHATSAPP', url: 'https://wa.me/5519912345678' },
              { platform: 'INSTAGRAM', url: 'https://instagram.com/padariacontato' },
            ]),
          }),
        }),
      );
      expect(tx.leadEnrichment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            leadId: 'lead-contato',
            type: 'contact_enrichment',
            data: expect.objectContaining({ source: 'apify_actor' }),
          }),
        }),
      );
      // Duas chamadas de actor nesta passada (scrapeContactInfo +
      // lookupInstagramProfile) — custo somado (0,05 + 0,05).
      expect(recordSpend).toHaveBeenCalledWith(fakeRedis, 'org-1', 0.1);
      expect(result.status).toBe('COMPLETED');
    });

    it('(b) caminho primário falha → cai no fallback Camoufox, LeadEnrichment{source:"camoufox_fallback"} e wa.me popula whatsapp direto', async () => {
      const tx = setupTx();
      (isOverBudget as jest.Mock).mockResolvedValue(false);
      const prisma = buildPrisma();
      prisma.scrapeJob.findFirstOrThrow.mockResolvedValue(contactJob);
      prisma.organization.findUniqueOrThrow.mockResolvedValue({ scrapingMonthlyBudget: null });
      tx.scrapeJob.update.mockResolvedValue({ ...contactJob, status: 'COMPLETED' });
      tx.lead.upsert.mockImplementation((args: { create: Record<string, unknown> }) =>
        Promise.resolve({ id: 'lead-fallback', ...args.create }),
      );

      const gateways = fakeGateways();
      gateways.apify.searchBusinesses.mockResolvedValue([apifyCandidateWithWebsite({ placeId: 'place-fallback' })]);
      gateways.explorium.matchBusiness.mockResolvedValue(null);
      gateways.contactEnrichment.scrapeContactInfo.mockRejectedValue(new Error('actor indisponível'));
      gateways.camofox.search.mockResolvedValue([
        { title: 'Perfil Instagram', url: 'https://instagram.com/padariacontato', textContent: null, raw: {} },
        { title: 'Fale no WhatsApp', url: 'https://wa.me/5519912345678', textContent: null, raw: {} },
        { title: 'Página irrelevante', url: 'https://exemplo.com', textContent: null, raw: {} },
      ]);

      const result = await processLeadScrapeJob(prisma as never, gateways as never, fakeRedis as never, jobData);

      expect(gateways.contactEnrichment.scrapeContactInfo).toHaveBeenCalled();
      // Lookup de Instagram nunca roda no fallback (só existe no caminho primário).
      expect(gateways.contactEnrichment.lookupInstagramProfile).not.toHaveBeenCalled();
      expect(gateways.camofox.search).toHaveBeenCalledWith(
        expect.objectContaining({ macro: '@google_search', limit: 5 }),
      );
      expect(tx.lead.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            whatsapp: 'https://wa.me/5519912345678',
            socialLinks: expect.arrayContaining([
              { platform: 'INSTAGRAM', url: 'https://instagram.com/padariacontato' },
              { platform: 'WHATSAPP', url: 'https://wa.me/5519912345678' },
            ]),
          }),
        }),
      );
      expect(tx.leadEnrichment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'contact_enrichment',
            data: expect.objectContaining({ source: 'camoufox_fallback' }),
          }),
        }),
      );
      // Custo do fallback = mesma taxa de CAMOFOX_GOOGLE_SEARCH (é literalmente a mesma chamada).
      expect(recordSpend).toHaveBeenCalledWith(fakeRedis, 'org-1', 0.001);
      expect(result.status).toBe('COMPLETED');
    });

    it('(c) caminho primário e fallback ambos sem resultado → lead segue sem contato novo, job principal não falha', async () => {
      const tx = setupTx();
      (isOverBudget as jest.Mock).mockResolvedValue(false);
      const prisma = buildPrisma();
      prisma.scrapeJob.findFirstOrThrow.mockResolvedValue(contactJob);
      prisma.organization.findUniqueOrThrow.mockResolvedValue({ scrapingMonthlyBudget: null });
      tx.scrapeJob.update.mockResolvedValue({ ...contactJob, status: 'COMPLETED' });
      tx.lead.upsert.mockImplementation((args: { create: Record<string, unknown> }) =>
        Promise.resolve({ id: 'lead-vazio', ...args.create }),
      );

      const gateways = fakeGateways();
      gateways.apify.searchBusinesses.mockResolvedValue([apifyCandidateWithWebsite({ placeId: 'place-vazio' })]);
      gateways.explorium.matchBusiness.mockResolvedValue(null);
      gateways.contactEnrichment.scrapeContactInfo.mockRejectedValue(new Error('actor indisponível'));
      gateways.camofox.search.mockResolvedValue([]); // fallback também não acha nada

      const result = await processLeadScrapeJob(prisma as never, gateways as never, fakeRedis as never, jobData);

      const createArg = tx.lead.upsert.mock.calls[0][0].create as Record<string, unknown>;
      expect(createArg.whatsapp).toBeUndefined();
      expect(createArg.email).toBeUndefined();
      expect(createArg.socialLinks).toBeUndefined();
      // Nenhum LeadEnrichment de contato é criado quando nada foi encontrado.
      expect(tx.leadEnrichment.create).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ type: 'contact_enrichment' }) }),
      );
      expect(result.status).toBe('COMPLETED');
      expect(tx.scrapeJob.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED', leadsFound: 1 }) }),
      );
    });

    it('(d) orçamento de scraping estourado no meio do job → descoberta de contato pula silenciosamente (mas o resto do job continua)', async () => {
      const tx = setupTx();
      (isOverBudget as jest.Mock)
        .mockResolvedValueOnce(false) // checagem a nível de job (passo 2)
        .mockResolvedValueOnce(true); // checagem por lead, dentro de discoverContactAndSocials
      const prisma = buildPrisma();
      prisma.scrapeJob.findFirstOrThrow.mockResolvedValue(contactJob);
      prisma.organization.findUniqueOrThrow.mockResolvedValue({ scrapingMonthlyBudget: 10 });
      tx.scrapeJob.update.mockResolvedValue({ ...contactJob, status: 'COMPLETED' });
      tx.lead.upsert.mockImplementation((args: { create: Record<string, unknown> }) =>
        Promise.resolve({ id: 'lead-budget', ...args.create }),
      );

      const gateways = fakeGateways();
      gateways.apify.searchBusinesses.mockResolvedValue([apifyCandidateWithWebsite({ placeId: 'place-budget' })]);
      gateways.explorium.matchBusiness.mockResolvedValue(null);

      const result = await processLeadScrapeJob(prisma as never, gateways as never, fakeRedis as never, jobData);

      expect(gateways.contactEnrichment.scrapeContactInfo).not.toHaveBeenCalled();
      expect(gateways.camofox.search).not.toHaveBeenCalled();
      expect(tx.lead.upsert).toHaveBeenCalledTimes(1);
      expect(tx.leadEnrichment.create).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ type: 'contact_enrichment' }) }),
      );
      expect(result.status).toBe('COMPLETED');
    });

    it('(e) Lead já existente (mesmo placeId) já tem whatsapp/socialLinks → pré-fetch batched pula a descoberta, nenhuma chamada paga nova', async () => {
      const tx = setupTx();
      (isOverBudget as jest.Mock).mockResolvedValue(false);
      const prisma = buildPrisma();
      prisma.scrapeJob.findFirstOrThrow.mockResolvedValue(contactJob);
      prisma.organization.findUniqueOrThrow.mockResolvedValue({ scrapingMonthlyBudget: null });
      prisma.lead.findMany.mockResolvedValue([
        {
          placeId: 'place-existente',
          rawSnapshot: null,
          name: 'Padaria Contato',
          city: 'Campinas',
          state: 'SP',
          whatsapp: 'https://wa.me/5519900000000',
          socialLinks: [{ platform: 'INSTAGRAM', url: 'https://instagram.com/padariacontato' }],
        },
      ]);
      tx.scrapeJob.update.mockResolvedValue({ ...contactJob, status: 'COMPLETED' });
      tx.lead.upsert.mockImplementation((args: { create: Record<string, unknown> }) =>
        Promise.resolve({ id: 'lead-existente', ...args.create }),
      );

      const gateways = fakeGateways();
      gateways.apify.searchBusinesses.mockResolvedValue([apifyCandidateWithWebsite({ placeId: 'place-existente' })]);
      gateways.explorium.matchBusiness.mockResolvedValue(null);

      const result = await processLeadScrapeJob(prisma as never, gateways as never, fakeRedis as never, jobData);

      // Uma única query batched (nunca N) — filtra por organizationId e usa
      // placeId como uma das estratégias de match do OR.
      expect(prisma.lead.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.lead.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: 'org-1',
            OR: expect.arrayContaining([{ placeId: { in: ['place-existente'] } }]),
          }),
        }),
      );
      expect(gateways.contactEnrichment.scrapeContactInfo).not.toHaveBeenCalled();
      expect(gateways.contactEnrichment.lookupInstagramProfile).not.toHaveBeenCalled();
      expect(gateways.camofox.search).not.toHaveBeenCalled();
      // Só o `recordSpend` de custo do job (Apify base) — nenhum extra pela
      // descoberta de contato, que nem chegou a rodar.
      expect(recordSpend).toHaveBeenCalledTimes(1);
      expect(tx.leadEnrichment.create).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ type: 'contact_enrichment' }) }),
      );
      expect(result.status).toBe('COMPLETED');
    });

    it('(f) Lead já existente sem placeId (fonte Explorium) — casado pela mesma URL normalizada (_dedupUrl) — também pula a descoberta', async () => {
      const tx = setupTx();
      (isOverBudget as jest.Mock).mockResolvedValue(false);
      const prisma = buildPrisma();
      const exploriumJob = { ...contactJob, sourceType: 'EXPLORIUM_BUSINESS_SEARCH' as const };
      prisma.scrapeJob.findFirstOrThrow.mockResolvedValue(exploriumJob);
      prisma.organization.findUniqueOrThrow.mockResolvedValue({ scrapingMonthlyBudget: null });
      prisma.lead.findMany.mockResolvedValue([
        {
          placeId: null,
          rawSnapshot: { _dedupUrl: 'padariaexplorium.com.br' },
          name: 'Padaria Explorium 2',
          city: null,
          state: null,
          whatsapp: 'https://wa.me/5519900000001',
          socialLinks: [{ platform: 'FACEBOOK', url: 'https://facebook.com/padariaexplorium2' }],
        },
      ]);
      tx.scrapeJob.update.mockResolvedValue({ ...exploriumJob, status: 'COMPLETED' });
      // Lead da Explorium não tem placeId — passa pelo caminho de dedup via
      // findFirst (mock devolve null aqui, "não existe ainda" NA TX de
      // persistência — o que importa pro pré-fetch é o findMany acima) + create.
      tx.lead.create.mockImplementation((args: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'lead-explorium-2', ...args.data }),
      );

      const gateways = fakeGateways();
      gateways.explorium.searchBusinesses.mockResolvedValue([
        {
          name: 'Padaria Explorium 2',
          website: 'https://padariaexplorium.com.br',
          industry: 'Alimentação',
          employeeCount: 5,
          revenueUsd: 100_000,
          matchConfidence: 0.9,
          raw: {},
        },
      ]);

      const result = await processLeadScrapeJob(prisma as never, gateways as never, fakeRedis as never, jobData);

      expect(gateways.contactEnrichment.scrapeContactInfo).not.toHaveBeenCalled();
      expect(gateways.camofox.search).not.toHaveBeenCalled();
      expect(tx.leadEnrichment.create).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ type: 'contact_enrichment' }) }),
      );
      expect(result.status).toBe('COMPLETED');
    });

    it('fallback Camoufox: dedup por platform e cap em 6 socialLinks', async () => {
      const tx = setupTx();
      (isOverBudget as jest.Mock).mockResolvedValue(false);
      const prisma = buildPrisma();
      prisma.scrapeJob.findFirstOrThrow.mockResolvedValue(contactJob);
      prisma.organization.findUniqueOrThrow.mockResolvedValue({ scrapingMonthlyBudget: null });
      tx.scrapeJob.update.mockResolvedValue({ ...contactJob, status: 'COMPLETED' });
      tx.lead.upsert.mockImplementation((args: { create: Record<string, unknown> }) =>
        Promise.resolve({ id: 'lead-cap', ...args.create }),
      );

      const gateways = fakeGateways();
      gateways.apify.searchBusinesses.mockResolvedValue([
        apifyCandidateWithWebsite({ website: null, placeId: 'place-cap' }),
      ]);
      gateways.explorium.matchBusiness.mockResolvedValue(null);
      gateways.camofox.search.mockResolvedValue([
        { title: 'Instagram 1', url: 'https://instagram.com/a', textContent: null, raw: {} },
        { title: 'Instagram 2 (duplicado)', url: 'https://instagram.com/b', textContent: null, raw: {} },
        { title: 'Facebook', url: 'https://facebook.com/a', textContent: null, raw: {} },
        { title: 'LinkedIn', url: 'https://linkedin.com/company/a', textContent: null, raw: {} },
        { title: 'TikTok', url: 'https://tiktok.com/@a', textContent: null, raw: {} },
        { title: 'Twitter', url: 'https://twitter.com/a', textContent: null, raw: {} },
        { title: 'YouTube', url: 'https://youtube.com/a', textContent: null, raw: {} },
        { title: 'Sem plataforma reconhecível', url: 'https://exemplo.com', textContent: null, raw: {} },
      ]);

      await processLeadScrapeJob(prisma as never, gateways as never, fakeRedis as never, jobData);

      const createArg = tx.lead.upsert.mock.calls[0][0].create as { socialLinks: Array<{ platform: string; url: string }> };
      // 7 plataformas reconhecíveis no total (instagram aparece 2x — dedup mantém só a 1ª) — cap em 6.
      expect(createArg.socialLinks).toHaveLength(6);
      expect(createArg.socialLinks).toEqual(
        expect.arrayContaining([{ platform: 'INSTAGRAM', url: 'https://instagram.com/a' }]),
      );
      expect(createArg.socialLinks).not.toEqual(
        expect.arrayContaining([{ platform: 'INSTAGRAM', url: 'https://instagram.com/b' }]),
      );
    });
  });
});
