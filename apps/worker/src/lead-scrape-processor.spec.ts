jest.mock('./tenant-context', () => ({
  withTenantContext: jest.fn((_prisma: unknown, _orgId: string, fn: (tx: unknown) => unknown) => fn('TX')),
}));
jest.mock('./budget', () => ({
  isOverBudget: jest.fn(),
  recordSpend: jest.fn(),
}));

import {
  processLeadScrapeJob,
  normalizeUrlForDedup,
  extractWhatsappPhone,
  extractInstagramHandle,
  looksLikeDirectoryOrListicle,
} from './lead-scrape-processor';
import { isOverBudget, recordSpend } from './budget';

describe('extractWhatsappPhone', () => {
  it('extrai os dígitos de um link wa.me', () => {
    expect(extractWhatsappPhone('https://wa.me/5519912345678')).toBe('5519912345678');
    expect(extractWhatsappPhone('https://wa.me/+55 19 91234-5678')).toBe('5519912345678');
  });

  it('extrai o parâmetro `phone` de um link api.whatsapp.com/send', () => {
    expect(
      extractWhatsappPhone('https://api.whatsapp.com/send?phone=5519912345678&text=Ol%C3%A1'),
    ).toBe('5519912345678');
  });

  it('devolve null para link sem telefone reconhecível, domínio de outra rede, lixo ou null', () => {
    expect(extractWhatsappPhone('https://wa.me/message/ABCDEF')).toBeNull();
    expect(extractWhatsappPhone('https://instagram.com/fulano')).toBeNull();
    expect(extractWhatsappPhone('não é uma url')).toBeNull();
    expect(extractWhatsappPhone(null)).toBeNull();
  });
});

describe('extractInstagramHandle', () => {
  it('extrai o handle de um link de perfil legítimo', () => {
    expect(extractInstagramHandle('https://instagram.com/padariacontato')).toBe('padariacontato');
    expect(extractInstagramHandle('https://www.instagram.com/padaria.contato/?hl=pt')).toBe(
      'padaria.contato',
    );
  });

  it('rejeita (null) segmentos reservados do Instagram que não são handle de perfil', () => {
    // Achado real: links de post/reel/etc. são comuns em resultados de
    // busca genérica (fallback Camofox) e batiam no mesmo regex de handle.
    expect(extractInstagramHandle('https://www.instagram.com/p/C1abc123/')).toBeNull();
    expect(extractInstagramHandle('https://www.instagram.com/reel/XyZ789/')).toBeNull();
    expect(extractInstagramHandle('https://www.instagram.com/reels/XyZ789/')).toBeNull();
    expect(extractInstagramHandle('https://www.instagram.com/explore/locations/123/')).toBeNull();
    expect(extractInstagramHandle('https://www.instagram.com/stories/alguem/123/')).toBeNull();
    expect(extractInstagramHandle('https://www.instagram.com/tv/XyZ789/')).toBeNull();
    expect(extractInstagramHandle('https://www.instagram.com/accounts/login/')).toBeNull();
    expect(extractInstagramHandle('https://www.instagram.com/direct/inbox/')).toBeNull();
  });
});

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

describe('looksLikeDirectoryOrListicle', () => {
  it('descarta domínio de portal conhecido', () => {
    expect(
      looksLikeDirectoryOrListicle({
        title: 'Imobiliárias em São Paulo | SP Imóvel',
        url: 'https://www.imovelweb.com.br/imobiliarias-sao-paulo.html',
      }),
    ).toBe(true);
  });

  it('descarta título estilo listicle ("melhores")', () => {
    expect(
      looksLikeDirectoryOrListicle({
        title: 'As 20 melhores barbearias em São Paulo (SP) · AvataReel',
        url: 'https://avatareel.com.br/melhores-barbearias-sp',
      }),
    ).toBe(true);
  });

  it('descarta título estilo listicle ("N ... em <cidade>")', () => {
    expect(
      looksLikeDirectoryOrListicle({
        title: '766 imobiliárias em São Paulo Estado de São Paulo - Imovelweb',
        url: 'https://www.imovelweb.com.br/imobiliarias-sao-paulo.html',
      }),
    ).toBe(true);
  });

  it('NÃO descarta um negócio real (domínio desconhecido, título é só o nome do negócio)', () => {
    expect(
      looksLikeDirectoryOrListicle({ title: 'Padaria Central', url: 'https://padariacentral.com.br' }),
    ).toBe(false);
    expect(
      looksLikeDirectoryOrListicle({ title: 'Imóveis Silva', url: 'https://imoveissilva.com.br/contato' }),
    ).toBe(false);
  });

  it('sem título (null) e domínio desconhecido não descarta', () => {
    expect(looksLikeDirectoryOrListicle({ title: null, url: 'https://negocio-qualquer.com.br' })).toBe(false);
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
        // `findUnique` (pré-check de dedup por placeId, antes de pontuar —
        // ver `upsertLead`) default "não existe ainda", mesmo espírito do
        // `findFirst` abaixo (dedup sem placeId).
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        update: jest.fn(),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      // Roteamento (Trilha B) — default "nenhum membro elegível", testes que
      // não são sobre atribuição não precisam mockar isto (auto-assign
      // simplesmente não faz nada quando a lista vem vazia).
      membership: { findMany: jest.fn().mockResolvedValue([]) },
      leadEnrichment: { create: jest.fn() },
      // Usado por `loadConfirmedSignalsForScoring` (pré-pontuação, ver
      // `upsertLead`) e pela checagem de "já foi investigado" do gatilho
      // de autodraft/investigação — default "nenhum sinal ainda", testes
      // que não são sobre isso não precisam mockar.
      leadSignal: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
      // Usado só pelo gatilho automático de outreach (B4/Task 11, ver
      // `resolveAutodraftChannel`/trecho no meio do loop do Passo 3) — default
      // "nenhum OutreachMessage ainda" (0), testes que não são sobre o
      // gatilho nem chegam a acionar essa checagem (suggestedOfferingId
      // sempre null nos testes pré-Task 11, ver offerings=[] default).
      outreachMessage: { count: jest.fn().mockResolvedValue(0) },
      pipelineStageTransition: { create: jest.fn() },
    };
  }

  function buildPrisma() {
    return {
      scrapeJob: {
        findFirstOrThrow: jest.fn(),
        update: jest.fn(),
        // Usados só pelo fallback automático Apify→Camofox
        // (`maybeEnqueueApifyFallback`) — default "nenhum fallback existe
        // ainda" / "cria sem erro". Testes que não são sobre o fallback não
        // precisam mockar isto; com poucos candidatos de fixture (comum nos
        // testes abaixo), a condição de fallback frequentemente dispara de
        // qualquer jeito, então precisa de um default seguro aqui.
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'fallback-job-1' }),
      },
      organization: { findUniqueOrThrow: jest.fn() },
      auditLog: { create: jest.fn() },
      costEvent: { create: jest.fn() },
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
    // Cobrado por resultado DEVOLVIDO pela Apify (2 lugares × US$0,005), não
    // pelo lead mantido depois do filtro onlyWithoutWebsite (1).
    expect(recordSpend).toHaveBeenCalledWith(fakeRedis, 'org-1', 0.01);
    expect(result.status).toBe('COMPLETED');
    expect(prisma.costEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: 'org-1',
        category: 'SCRAPING',
        provider: 'APIFY_GOOGLE_MAPS',
        amountUsd: 0.01,
        scrapeJobId: 'scrape-1',
      }),
    });
    expect(tx.pipelineStageTransition.create).toHaveBeenCalledTimes(1);
    expect(tx.pipelineStageTransition.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ organizationId: 'org-1', leadId: 'lead-1', fromStage: null }),
    });
  });

  it('Apify devolve o estado por extenso ("São Paulo"): o lead é gravado com a sigla, como a busca', async () => {
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
        name: 'Metalúrgica Dias',
        address: 'R. Itapetininga, 555 - Cidade Jardim, Campinas - SP, 13050-432, Brazil',
        city: 'Campinas',
        state: 'São Paulo',
        phone: null,
        website: null,
        googleCategory: 'Metallurgy company',
        rating: null,
        reviewCount: null,
        placeId: 'ChIJL44na2fJyJQRGtz-cdpq1co',
        raw: { countryCode: 'BR' },
      },
    ]);
    gateways.explorium.matchBusiness.mockResolvedValue(null);

    await processLeadScrapeJob(prisma as never, gateways as never, fakeRedis as never, jobData);

    expect(tx.lead.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ state: 'SP', phone: null }) }),
    );
  });

  it('rescan de um lead que já avançou (CONTACTED) não regride o status nem grava transição', async () => {
    const tx = setupTx();
    (isOverBudget as jest.Mock).mockResolvedValue(false);
    const prisma = buildPrisma();
    prisma.scrapeJob.findFirstOrThrow.mockResolvedValue(baseScrapeJob);
    prisma.organization.findUniqueOrThrow.mockResolvedValue({ scrapingMonthlyBudget: null });
    tx.scrapeJob.update.mockResolvedValue({ ...baseScrapeJob, status: 'COMPLETED' });
    tx.lead.findUnique.mockResolvedValue({ id: 'lead-1', status: 'CONTACTED' });
    tx.lead.upsert.mockImplementation((args: { update: Record<string, unknown> }) =>
      Promise.resolve({ id: 'lead-1', ...args.update }),
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
    ]);
    gateways.explorium.matchBusiness.mockResolvedValue(null);

    await processLeadScrapeJob(prisma as never, gateways as never, fakeRedis as never, jobData);

    expect(tx.lead.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ status: 'CONTACTED' }) }),
    );
    expect(tx.pipelineStageTransition.create).not.toHaveBeenCalled();
  });

  // Regressão do bug real (2026-09): antes da Fase 1 do fix de scoring, todo
  // lead do Camoufox ganhava os 50 pontos de "sem site" incondicionalmente
  // (o campo nunca é capturado por essa fonte, então `website` era sempre
  // `null`) — o que sozinho já cruzava QUALIFICATION_THRESHOLD, mesmo pra um
  // resultado sem nenhum sinal real de que é um negócio de verdade.
  it('sucesso (Camoufox): sem confirmação de site nem keyword batendo, lead sai DISQUALIFIED (antes qualificava só pela fonte)', async () => {
    const tx = setupTx();
    (isOverBudget as jest.Mock).mockResolvedValue(false);
    const prisma = buildPrisma();
    prisma.scrapeJob.findFirstOrThrow.mockResolvedValue({
      ...baseScrapeJob,
      sourceType: 'CAMOFOX_GOOGLE_SEARCH' as const,
      businessType: 'imobiliaria',
    });
    prisma.organization.findUniqueOrThrow.mockResolvedValue({ scrapingMonthlyBudget: null });
    tx.scrapeJob.update.mockResolvedValue({ ...baseScrapeJob, status: 'COMPLETED' });
    // Camoufox nunca tem `placeId` — vai pelo caminho de dedup por URL/nome
    // (`tx.lead.findFirst` + `tx.lead.create`), não `tx.lead.upsert` (esse é
    // só pro caminho com `placeId`, fontes estruturadas).
    tx.lead.create.mockImplementation((args: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'lead-1', ...args.data }),
    );

    const gateways = fakeGateways();
    // Deliberadamente NÃO um exemplo de portal/listicle (isso é coberto pelo
    // filtro da Fase 2, testado separadamente em `looksLikeDirectoryOrListicle`)
    // — aqui o objetivo é isolar só o fix de scoring da Fase 1: um resultado
    // que passa pelo filtro de ingestão mas ainda assim não tem nenhuma
    // confirmação real de ausência de site.
    gateways.camofox.search.mockResolvedValue([
      { title: 'Imóveis Silva', url: 'https://imoveissilva.com.br/contato', textContent: null, raw: {} },
    ]);

    await processLeadScrapeJob(prisma as never, gateways as never, fakeRedis as never, jobData);

    expect(tx.lead.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'DISQUALIFIED',
          score: 0,
          scoreBreakdown: expect.objectContaining({ hasNoWebsitePoints: 0 }),
        }),
      }),
    );
  });

  describe('isWhatsappCandidate (sinal de priorização, não confirmado)', () => {
    it('Apify: telefone presente + site confirmado ausente => isWhatsappCandidate true', async () => {
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
          phone: '+5519999999999',
          website: null,
          googleCategory: 'Padaria',
          rating: 4.5,
          reviewCount: 20,
          placeId: 'place-1',
          raw: {},
        },
      ]);
      gateways.explorium.matchBusiness.mockResolvedValue(null);

      await processLeadScrapeJob(prisma as never, gateways as never, fakeRedis as never, jobData);

      expect(tx.lead.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ create: expect.objectContaining({ isWhatsappCandidate: true }) }),
      );
    });

    it('Apify: telefone presente mas COM site => isWhatsappCandidate false (não é o segmento-alvo)', async () => {
      const tx = setupTx();
      (isOverBudget as jest.Mock).mockResolvedValue(false);
      const prisma = buildPrisma();
      prisma.scrapeJob.findFirstOrThrow.mockResolvedValue({ ...baseScrapeJob, onlyWithoutWebsite: false });
      prisma.organization.findUniqueOrThrow.mockResolvedValue({ scrapingMonthlyBudget: null });
      tx.scrapeJob.update.mockResolvedValue({ ...baseScrapeJob, status: 'COMPLETED' });
      tx.lead.upsert.mockImplementation((args: { create: Record<string, unknown> }) =>
        Promise.resolve({ id: 'lead-1', ...args.create }),
      );

      const gateways = fakeGateways();
      gateways.apify.searchBusinesses.mockResolvedValue([
        {
          name: 'Padaria Com Site',
          address: null,
          city: 'Campinas',
          state: 'SP',
          phone: '+5519999999999',
          website: 'https://comsite.com',
          googleCategory: 'Padaria',
          rating: 4.0,
          reviewCount: 5,
          placeId: 'place-2',
          raw: {},
        },
      ]);
      gateways.explorium.matchBusiness.mockResolvedValue(null);

      await processLeadScrapeJob(prisma as never, gateways as never, fakeRedis as never, jobData);

      expect(tx.lead.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ create: expect.objectContaining({ isWhatsappCandidate: false }) }),
      );
    });

    it('sem telefone => isWhatsappCandidate false mesmo sem site', async () => {
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
          name: 'Padaria Sem Telefone',
          address: null,
          city: 'Campinas',
          state: 'SP',
          phone: null,
          website: null,
          googleCategory: 'Padaria',
          rating: 4.5,
          reviewCount: 20,
          placeId: 'place-3',
          raw: {},
        },
      ]);
      gateways.explorium.matchBusiness.mockResolvedValue(null);

      await processLeadScrapeJob(prisma as never, gateways as never, fakeRedis as never, jobData);

      expect(tx.lead.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ create: expect.objectContaining({ isWhatsappCandidate: false }) }),
      );
    });
  });

  // Fase 2: filtro de ingestão — lote misto (2 portais/listicles + 1 negócio
  // real) só persiste o negócio real. Complementa o teste de scoring acima:
  // aqui o lixo nem chega a virar `Lead`.
  it('CAMOFOX_GOOGLE_SEARCH: lote misto de portal/listicle + negócio real só persiste o negócio real', async () => {
    const tx = setupTx();
    (isOverBudget as jest.Mock).mockResolvedValue(false);
    const prisma = buildPrisma();
    prisma.scrapeJob.findFirstOrThrow.mockResolvedValue({
      ...baseScrapeJob,
      sourceType: 'CAMOFOX_GOOGLE_SEARCH' as const,
      businessType: 'imobiliaria',
    });
    prisma.organization.findUniqueOrThrow.mockResolvedValue({ scrapingMonthlyBudget: null });
    tx.scrapeJob.update.mockResolvedValue({ ...baseScrapeJob, status: 'COMPLETED' });
    tx.lead.create.mockImplementation((args: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'lead-1', ...args.data }),
    );

    const gateways = fakeGateways();
    gateways.camofox.search.mockResolvedValue([
      {
        title: '766 imobiliárias em São Paulo Estado de São Paulo - Imovelweb',
        url: 'https://www.imovelweb.com.br/imobiliarias-sao-paulo.html',
        textContent: null,
        raw: {},
      },
      {
        title: 'As 20 melhores imobiliárias de São Paulo · AvataReel',
        url: 'https://avatareel.com.br/melhores-imobiliarias-sp',
        textContent: null,
        raw: {},
      },
      { title: 'Imóveis Silva', url: 'https://imoveissilva.com.br/contato', textContent: null, raw: {} },
    ]);

    await processLeadScrapeJob(prisma as never, gateways as never, fakeRedis as never, jobData);

    expect(tx.lead.create).toHaveBeenCalledTimes(1);
    expect(tx.lead.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: 'Imóveis Silva' }) }),
    );
    expect(tx.scrapeJob.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ leadsFound: 1 }) }),
    );
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
            // `whatsapp` guarda SÓ o número (ver `extractWhatsappPhone`); o
            // link completo continua em `socialLinks`.
            whatsapp: '5519912345678',
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

    it('(b) caminho primário falha → cai no fallback Camoufox, LeadEnrichment{source:"camoufox_fallback"} e o wa.me vira número em whatsapp + link em socialLinks', async () => {
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
      // Achou um Instagram via busca genérica no fallback → chama o mesmo
      // lookup de perfil que o caminho primário já chamava (antes só
      // guardava o link crú, sem extrair telefone/e-mail de dentro do
      // perfil — gap real pro segmento sem site, onde o fallback é o
      // ÚNICO caminho que roda).
      expect(gateways.contactEnrichment.lookupInstagramProfile).toHaveBeenCalledWith('padariacontato');
      expect(gateways.camofox.search).toHaveBeenCalledWith(
        expect.objectContaining({ macro: '@google_search', limit: 5 }),
      );
      expect(tx.lead.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            whatsapp: '5519912345678',
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
      // Custo do fallback = CAMOFOX_GOOGLE_SEARCH (0,001) + lookup de
      // Instagram (0,05), já que um perfil foi encontrado e consultado.
      // `closeTo` por causa de imprecisão de ponto flutuante na soma
      // (0.001 + 0.05 !== 0.051 exatamente em IEEE754).
      expect(recordSpend).toHaveBeenCalledWith(fakeRedis, 'org-1', expect.closeTo(0.051, 5));
      expect(result.status).toBe('COMPLETED');
    });

    it('sem website (segmento-alvo): fallback é o ÚNICO caminho, e o perfil do Instagram encontrado preenche e-mail + WhatsApp', async () => {
      const tx = setupTx();
      (isOverBudget as jest.Mock).mockResolvedValue(false);
      const prisma = buildPrisma();
      prisma.scrapeJob.findFirstOrThrow.mockResolvedValue(contactJob);
      prisma.organization.findUniqueOrThrow.mockResolvedValue({ scrapingMonthlyBudget: null });
      tx.scrapeJob.update.mockResolvedValue({ ...contactJob, status: 'COMPLETED' });
      tx.lead.upsert.mockImplementation((args: { create: Record<string, unknown> }) =>
        Promise.resolve({ id: 'lead-sem-site', ...args.create }),
      );

      const gateways = fakeGateways();
      // SEM website desde a origem — `runPrimaryContactDiscovery` nunca
      // chega a rodar (retorna null de cara), então o fallback é o ÚNICO
      // caminho de descoberta de contato pra este lead.
      gateways.apify.searchBusinesses.mockResolvedValue([
        apifyCandidateWithWebsite({ placeId: 'place-sem-site', website: null }),
      ]);
      gateways.explorium.matchBusiness.mockResolvedValue(null);
      gateways.camofox.search.mockResolvedValue([
        { title: 'Perfil Instagram', url: 'https://instagram.com/padariasemsite', textContent: null, raw: {} },
      ]);
      gateways.contactEnrichment.lookupInstagramProfile.mockResolvedValue({
        bio: 'Padaria artesanal',
        whatsappLink: 'https://wa.me/5519987654321',
        email: 'contato@padariasemsite.com.br',
      });

      await processLeadScrapeJob(prisma as never, gateways as never, fakeRedis as never, jobData);

      expect(gateways.contactEnrichment.scrapeContactInfo).not.toHaveBeenCalled();
      expect(gateways.contactEnrichment.lookupInstagramProfile).toHaveBeenCalledWith('padariasemsite');
      expect(tx.lead.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            whatsapp: '5519987654321',
            email: 'contato@padariasemsite.com.br',
            socialLinks: expect.arrayContaining([
              { platform: 'INSTAGRAM', url: 'https://instagram.com/padariasemsite' },
              { platform: 'WHATSAPP', url: 'https://wa.me/5519987654321' },
            ]),
          }),
        }),
      );
      expect(recordSpend).toHaveBeenCalledWith(fakeRedis, 'org-1', expect.closeTo(0.051, 5));
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

    it('(g) Lead já existente com socialLinks mas SEM whatsapp → também pula (semântica OU, não E): nenhum gasto novo', async () => {
      const tx = setupTx();
      (isOverBudget as jest.Mock).mockResolvedValue(false);
      const prisma = buildPrisma();
      prisma.scrapeJob.findFirstOrThrow.mockResolvedValue(contactJob);
      prisma.organization.findUniqueOrThrow.mockResolvedValue({ scrapingMonthlyBudget: null });
      // Caso dominante do fallback Camoufox: acha perfis sociais mas nenhum
      // link wa.me, então `whatsapp` fica null. Com a condição antiga (`&&`)
      // este lead seria re-enriquecido — e re-cobrado — em TODO re-scan por
      // cooldown do `ProspectingTarget`.
      prisma.lead.findMany.mockResolvedValue([
        {
          placeId: 'place-so-socials',
          rawSnapshot: null,
          name: 'Padaria Contato',
          city: 'Campinas',
          state: 'SP',
          whatsapp: null,
          socialLinks: [{ platform: 'INSTAGRAM', url: 'https://instagram.com/padariacontato' }],
        },
      ]);
      tx.scrapeJob.update.mockResolvedValue({ ...contactJob, status: 'COMPLETED' });
      tx.lead.upsert.mockImplementation((args: { create: Record<string, unknown> }) =>
        Promise.resolve({ id: 'lead-so-socials', ...args.create }),
      );

      const gateways = fakeGateways();
      gateways.apify.searchBusinesses.mockResolvedValue([
        apifyCandidateWithWebsite({ placeId: 'place-so-socials' }),
      ]);
      gateways.explorium.matchBusiness.mockResolvedValue(null);

      const result = await processLeadScrapeJob(prisma as never, gateways as never, fakeRedis as never, jobData);

      expect(gateways.contactEnrichment.scrapeContactInfo).not.toHaveBeenCalled();
      expect(gateways.contactEnrichment.lookupInstagramProfile).not.toHaveBeenCalled();
      expect(gateways.camofox.search).not.toHaveBeenCalled();
      // Só o `recordSpend` do custo do job em si — nada da descoberta de contato.
      expect(recordSpend).toHaveBeenCalledTimes(1);
      expect(result.status).toBe('COMPLETED');
    });

    it('(h) Lead já existente só com whatsapp (socialLinks vazio) → também pula, pelo mesmo OU', async () => {
      const tx = setupTx();
      (isOverBudget as jest.Mock).mockResolvedValue(false);
      const prisma = buildPrisma();
      prisma.scrapeJob.findFirstOrThrow.mockResolvedValue(contactJob);
      prisma.organization.findUniqueOrThrow.mockResolvedValue({ scrapingMonthlyBudget: null });
      prisma.lead.findMany.mockResolvedValue([
        {
          placeId: 'place-so-whats',
          rawSnapshot: null,
          name: 'Padaria Contato',
          city: 'Campinas',
          state: 'SP',
          whatsapp: '5519900000000',
          socialLinks: [],
        },
      ]);
      tx.scrapeJob.update.mockResolvedValue({ ...contactJob, status: 'COMPLETED' });
      tx.lead.upsert.mockImplementation((args: { create: Record<string, unknown> }) =>
        Promise.resolve({ id: 'lead-so-whats', ...args.create }),
      );

      const gateways = fakeGateways();
      gateways.apify.searchBusinesses.mockResolvedValue([
        apifyCandidateWithWebsite({ placeId: 'place-so-whats' }),
      ]);
      gateways.explorium.matchBusiness.mockResolvedValue(null);

      await processLeadScrapeJob(prisma as never, gateways as never, fakeRedis as never, jobData);

      expect(gateways.contactEnrichment.scrapeContactInfo).not.toHaveBeenCalled();
      expect(gateways.camofox.search).not.toHaveBeenCalled();
      expect(recordSpend).toHaveBeenCalledTimes(1);
    });

    it('(i) URL de esquema inseguro vinda do actor NUNCA é gravada em socialLinks (XSS armazenado)', async () => {
      const tx = setupTx();
      (isOverBudget as jest.Mock).mockResolvedValue(false);
      const prisma = buildPrisma();
      prisma.scrapeJob.findFirstOrThrow.mockResolvedValue(contactJob);
      prisma.organization.findUniqueOrThrow.mockResolvedValue({ scrapingMonthlyBudget: null });
      tx.scrapeJob.update.mockResolvedValue({ ...contactJob, status: 'COMPLETED' });
      tx.lead.upsert.mockImplementation((args: { create: Record<string, unknown> }) =>
        Promise.resolve({ id: 'lead-xss', ...args.create }),
      );

      const gateways = fakeGateways();
      gateways.apify.searchBusinesses.mockResolvedValue([apifyCandidateWithWebsite({ placeId: 'place-xss' })]);
      gateways.explorium.matchBusiness.mockResolvedValue(null);
      gateways.contactEnrichment.scrapeContactInfo.mockResolvedValue({
        emails: [],
        phones: [],
        socials: [
          { platform: 'INSTAGRAM', url: 'javascript:alert(1)//instagram.com' },
          { platform: 'FACEBOOK', url: 'https://facebook.com/legitima' },
        ],
      });

      await processLeadScrapeJob(prisma as never, gateways as never, fakeRedis as never, jobData);

      const createArg = tx.lead.upsert.mock.calls[0][0].create as Record<string, unknown>;
      expect(createArg.socialLinks).toEqual([{ platform: 'FACEBOOK', url: 'https://facebook.com/legitima' }]);
    });

    it('(j) fallback Camoufox: URL com esquema inseguro que casa por substring não vira socialLink', async () => {
      const tx = setupTx();
      (isOverBudget as jest.Mock).mockResolvedValue(false);
      const prisma = buildPrisma();
      prisma.scrapeJob.findFirstOrThrow.mockResolvedValue(contactJob);
      prisma.organization.findUniqueOrThrow.mockResolvedValue({ scrapingMonthlyBudget: null });
      tx.scrapeJob.update.mockResolvedValue({ ...contactJob, status: 'COMPLETED' });
      tx.lead.upsert.mockImplementation((args: { create: Record<string, unknown> }) =>
        Promise.resolve({ id: 'lead-xss-fallback', ...args.create }),
      );

      const gateways = fakeGateways();
      gateways.apify.searchBusinesses.mockResolvedValue([
        apifyCandidateWithWebsite({ website: null, placeId: 'place-xss-fb' }),
      ]);
      gateways.explorium.matchBusiness.mockResolvedValue(null);
      gateways.camofox.search.mockResolvedValue([
        // Casaria com /instagram\\.com/i (match por substring, não ancorado).
        { title: 'Falso Instagram', url: 'javascript:alert(1)//instagram.com', textContent: null, raw: {} },
        { title: 'Facebook', url: 'https://facebook.com/legitima', textContent: null, raw: {} },
      ]);

      await processLeadScrapeJob(prisma as never, gateways as never, fakeRedis as never, jobData);

      const createArg = tx.lead.upsert.mock.calls[0][0].create as Record<string, unknown>;
      expect(createArg.socialLinks).toEqual([{ platform: 'FACEBOOK', url: 'https://facebook.com/legitima' }]);
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

  describe('gatilho automático de outreach (B4/Task 11)', () => {
    // `website: null` em todos os candidatos abaixo: garante `hasNoWebsitePoints
    // = 50` sozinho já cruza `QUALIFICATION_THRESHOLD` (50), então o teste
    // não depende de afinar `rating`/`reviewCount`/firmographics pra "cair
    // certinho" no threshold — e mantém `onlyWithoutWebsite: true`
    // (`baseScrapeJob`) satisfeito. `website: null` também significa que a
    // descoberta de contato (Task 9) sempre cai no fallback Camoufox (o
    // caminho primário exige `candidate.website`) — por isso os mocks de
    // `gateways.camofox.search` abaixo, não de `contactEnrichment`.
    const matchingOffering = {
      id: 'offering-1',
      signals: [] as string[],
      targetIndustries: ['Padaria'],
      minEmployees: null,
      maxEmployees: null,
      minRevenueUsd: null,
      maxRevenueUsd: null,
    };

    function apifyCandidateNoWebsite(overrides: Record<string, unknown> = {}) {
      return {
        name: 'Padaria Autodraft',
        address: null,
        city: 'Campinas',
        state: 'SP',
        phone: null,
        website: null,
        googleCategory: 'Padaria',
        rating: 4.5,
        reviewCount: 20,
        placeId: 'place-autodraft',
        raw: {},
        ...overrides,
      };
    }

    const matchBusinessResult = {
      name: 'Padaria Autodraft',
      website: null,
      industry: 'Padaria',
      employeeCount: null,
      revenueUsd: null,
      matchConfidence: 0.9,
      raw: {},
    };

    function setupQualifyingRun(tx: ReturnType<typeof buildTx>, prisma: ReturnType<typeof buildPrisma>) {
      (isOverBudget as jest.Mock).mockResolvedValue(false);
      prisma.scrapeJob.findFirstOrThrow.mockResolvedValue(baseScrapeJob);
      prisma.organization.findUniqueOrThrow.mockResolvedValue({ scrapingMonthlyBudget: null });
      tx.scrapeJob.update.mockResolvedValue({ ...baseScrapeJob, status: 'COMPLETED' });
      tx.lead.upsert.mockImplementation((args: { create: Record<string, unknown> }) =>
        Promise.resolve({ id: `lead-${args.create.placeId as string}`, ...args.create }),
      );
    }

    it('QUALIFIED + WhatsApp, mas sem suggestedOfferingId → não enfileira', async () => {
      const tx = setupTx();
      const prisma = buildPrisma();
      setupQualifyingRun(tx, prisma);
      // offerings vazio (default de `buildTx`) — nenhuma oferta pra casar,
      // `suggestedOfferingId` fica null mesmo com o lead QUALIFIED.

      const gateways = fakeGateways();
      gateways.apify.searchBusinesses.mockResolvedValue([apifyCandidateNoWebsite()]);
      gateways.explorium.matchBusiness.mockResolvedValue(null);
      gateways.camofox.search.mockResolvedValue([
        { title: 'WhatsApp', url: 'https://wa.me/5519999999999', textContent: null, raw: {} },
      ]);

      const enqueueAutodraft = jest.fn().mockResolvedValue(undefined);
      const result = await processLeadScrapeJob(
        prisma as never,
        gateways as never,
        fakeRedis as never,
        jobData,
        enqueueAutodraft,
      );

      expect(enqueueAutodraft).not.toHaveBeenCalled();
      expect(result.status).toBe('COMPLETED');
    });

    it('QUALIFIED + oferta sugerida + WhatsApp → enfileira no canal WHATSAPP', async () => {
      const tx = setupTx();
      const prisma = buildPrisma();
      setupQualifyingRun(tx, prisma);
      tx.serviceOffering.findMany.mockResolvedValue([matchingOffering]);

      const gateways = fakeGateways();
      gateways.apify.searchBusinesses.mockResolvedValue([apifyCandidateNoWebsite()]);
      gateways.explorium.matchBusiness.mockResolvedValue(matchBusinessResult);
      gateways.camofox.search.mockResolvedValue([
        { title: 'WhatsApp', url: 'https://wa.me/5519999999999', textContent: null, raw: {} },
      ]);

      const enqueueAutodraft = jest.fn().mockResolvedValue(undefined);
      const result = await processLeadScrapeJob(
        prisma as never,
        gateways as never,
        fakeRedis as never,
        jobData,
        enqueueAutodraft,
      );

      expect(enqueueAutodraft).toHaveBeenCalledTimes(1);
      expect(enqueueAutodraft).toHaveBeenCalledWith({
        organizationId: 'org-1',
        leadId: 'lead-place-autodraft',
        channel: 'WHATSAPP',
        serviceOfferingId: 'offering-1',
      });
      expect(result.status).toBe('COMPLETED');
    });

    it('sem WhatsApp mas com Instagram em socialLinks → enfileira no canal INSTAGRAM_DM', async () => {
      const tx = setupTx();
      const prisma = buildPrisma();
      setupQualifyingRun(tx, prisma);
      tx.serviceOffering.findMany.mockResolvedValue([matchingOffering]);

      const gateways = fakeGateways();
      gateways.apify.searchBusinesses.mockResolvedValue([apifyCandidateNoWebsite()]);
      gateways.explorium.matchBusiness.mockResolvedValue(matchBusinessResult);
      gateways.camofox.search.mockResolvedValue([
        { title: 'Instagram', url: 'https://instagram.com/padariaautodraft', textContent: null, raw: {} },
      ]);

      const enqueueAutodraft = jest.fn().mockResolvedValue(undefined);
      await processLeadScrapeJob(prisma as never, gateways as never, fakeRedis as never, jobData, enqueueAutodraft);

      expect(enqueueAutodraft).toHaveBeenCalledTimes(1);
      expect(enqueueAutodraft).toHaveBeenCalledWith(
        expect.objectContaining({ channel: 'INSTAGRAM_DM', serviceOfferingId: 'offering-1' }),
      );
    });

    it('lead qualifica só com phone (sem whatsapp/instagram/linkedin/email) → enfileira no canal PHONE (ruling pós-review)', async () => {
      const tx = setupTx();
      const prisma = buildPrisma();
      setupQualifyingRun(tx, prisma);
      tx.serviceOffering.findMany.mockResolvedValue([matchingOffering]);

      const gateways = fakeGateways();
      gateways.apify.searchBusinesses.mockResolvedValue([
        apifyCandidateNoWebsite({ phone: '+5519999999999' }),
      ]);
      gateways.explorium.matchBusiness.mockResolvedValue(matchBusinessResult);
      // Sem website (caminho primário não roda) e sem nada reconhecível no
      // fallback Camoufox — nenhum whatsapp/socialLinks/email é descoberto,
      // só `phone` (já trazido pela própria busca do Apify) sobra como canal.
      gateways.camofox.search.mockResolvedValue([]);

      const enqueueAutodraft = jest.fn().mockResolvedValue(undefined);
      await processLeadScrapeJob(prisma as never, gateways as never, fakeRedis as never, jobData, enqueueAutodraft);

      expect(enqueueAutodraft).toHaveBeenCalledTimes(1);
      expect(enqueueAutodraft).toHaveBeenCalledWith({
        organizationId: 'org-1',
        leadId: 'lead-place-autodraft',
        channel: 'PHONE',
        serviceOfferingId: 'offering-1',
      });
    });

    it('lead já tem OutreachMessage → nunca enfileira de novo', async () => {
      const tx = setupTx();
      const prisma = buildPrisma();
      setupQualifyingRun(tx, prisma);
      tx.serviceOffering.findMany.mockResolvedValue([matchingOffering]);
      tx.outreachMessage.count.mockResolvedValue(1);

      const gateways = fakeGateways();
      gateways.apify.searchBusinesses.mockResolvedValue([apifyCandidateNoWebsite()]);
      gateways.explorium.matchBusiness.mockResolvedValue(matchBusinessResult);
      gateways.camofox.search.mockResolvedValue([
        { title: 'WhatsApp', url: 'https://wa.me/5519999999999', textContent: null, raw: {} },
      ]);

      const enqueueAutodraft = jest.fn().mockResolvedValue(undefined);
      await processLeadScrapeJob(prisma as never, gateways as never, fakeRedis as never, jobData, enqueueAutodraft);

      expect(tx.outreachMessage.count).toHaveBeenCalledWith({ where: { leadId: 'lead-place-autodraft' } });
      expect(enqueueAutodraft).not.toHaveBeenCalled();
    });

    it('teto de 10/job respeitado mesmo com 11 leads elegíveis no mesmo job', async () => {
      const tx = setupTx();
      const prisma = buildPrisma();
      setupQualifyingRun(tx, prisma);
      tx.serviceOffering.findMany.mockResolvedValue([matchingOffering]);

      const gateways = fakeGateways();
      const candidates = Array.from({ length: 11 }, (_, i) =>
        apifyCandidateNoWebsite({ placeId: `place-${i}` }),
      );
      gateways.apify.searchBusinesses.mockResolvedValue(candidates);
      gateways.explorium.matchBusiness.mockResolvedValue(matchBusinessResult);
      gateways.camofox.search.mockResolvedValue([
        { title: 'WhatsApp', url: 'https://wa.me/5519999999999', textContent: null, raw: {} },
      ]);

      const enqueueAutodraft = jest.fn().mockResolvedValue(undefined);
      const result = await processLeadScrapeJob(
        prisma as never,
        gateways as never,
        fakeRedis as never,
        jobData,
        enqueueAutodraft,
      );

      expect(tx.lead.upsert).toHaveBeenCalledTimes(11); // todos os 11 leads são persistidos normalmente
      expect(enqueueAutodraft).toHaveBeenCalledTimes(10); // só os 10 primeiros geram rascunho automático
      expect(result.status).toBe('COMPLETED');
    });

    describe('investigar site antes de rascunhar (Fase 7)', () => {
      function apifyCandidateWithWebsite(overrides: Record<string, unknown> = {}) {
        return apifyCandidateNoWebsite({ website: 'https://padariaautodraft.com.br', ...overrides });
      }

      // `hasNoWebsitePoints` (os 50 pontos usados pelos outros testes deste
      // describe) não se aplica a um lead COM site — por isso aqui o match
      // também bate em employeeCount/revenueUsd (a offering não restringe
      // faixa: `minEmployees`/`maxEmployees`/`minRevenueUsd`/`maxRevenueUsd`
      // todos `null`), somando icpFit=30 + activity=20 = 50, o suficiente
      // pra cruzar `QUALIFICATION_THRESHOLD` sem depender da ausência de site.
      const matchBusinessResultWithWebsite = {
        ...matchBusinessResult,
        employeeCount: 8,
        revenueUsd: 500_000,
      };

      it('lead recém-qualificado COM site e nunca investigado → vai pra WEBSITE_PROFILE, não dispara autodraft imediato', async () => {
        const tx = setupTx();
        const prisma = buildPrisma();
        setupQualifyingRun(tx, prisma);
        prisma.scrapeJob.findFirstOrThrow.mockResolvedValue({ ...baseScrapeJob, onlyWithoutWebsite: false });
        tx.serviceOffering.findMany.mockResolvedValue([matchingOffering]);
        tx.leadSignal.count.mockResolvedValue(0); // nunca investigado

        const gateways = fakeGateways();
        gateways.apify.searchBusinesses.mockResolvedValue([apifyCandidateWithWebsite()]);
        gateways.explorium.matchBusiness.mockResolvedValue(matchBusinessResultWithWebsite);
        gateways.camofox.search.mockResolvedValue([]);

        const enqueueAutodraft = jest.fn().mockResolvedValue(undefined);
        const enqueueWebsiteProfile = jest.fn().mockResolvedValue(undefined);
        const result = await processLeadScrapeJob(
          prisma as never,
          gateways as never,
          fakeRedis as never,
          jobData,
          enqueueAutodraft,
          enqueueWebsiteProfile,
        );

        expect(enqueueWebsiteProfile).toHaveBeenCalledTimes(1);
        expect(enqueueWebsiteProfile).toHaveBeenCalledWith({
          organizationId: 'org-1',
          leadId: 'lead-place-autodraft',
          actorType: jobData.actorType,
          actorId: jobData.actorId,
        });
        expect(enqueueAutodraft).not.toHaveBeenCalled();
        expect(result.status).toBe('COMPLETED');
      });

      it('lead recém-qualificado SEM site continua indo direto pro autodraft (nada a investigar)', async () => {
        const tx = setupTx();
        const prisma = buildPrisma();
        setupQualifyingRun(tx, prisma);
        tx.serviceOffering.findMany.mockResolvedValue([matchingOffering]);

        const gateways = fakeGateways();
        gateways.apify.searchBusinesses.mockResolvedValue([apifyCandidateNoWebsite()]);
        gateways.explorium.matchBusiness.mockResolvedValue(matchBusinessResult);
        gateways.camofox.search.mockResolvedValue([
          { title: 'WhatsApp', url: 'https://wa.me/5519999999999', textContent: null, raw: {} },
        ]);

        const enqueueAutodraft = jest.fn().mockResolvedValue(undefined);
        const enqueueWebsiteProfile = jest.fn().mockResolvedValue(undefined);
        await processLeadScrapeJob(
          prisma as never,
          gateways as never,
          fakeRedis as never,
          jobData,
          enqueueAutodraft,
          enqueueWebsiteProfile,
        );

        expect(enqueueWebsiteProfile).not.toHaveBeenCalled();
        expect(enqueueAutodraft).toHaveBeenCalledTimes(1);
        expect(enqueueAutodraft).toHaveBeenCalledWith(
          expect.objectContaining({ leadId: 'lead-place-autodraft', channel: 'WHATSAPP' }),
        );
      });

      it('lead COM site mas já investigado antes (LeadSignal existente) → não reinvestiga, cai no autodraft imediato', async () => {
        const tx = setupTx();
        const prisma = buildPrisma();
        setupQualifyingRun(tx, prisma);
        prisma.scrapeJob.findFirstOrThrow.mockResolvedValue({ ...baseScrapeJob, onlyWithoutWebsite: false });
        tx.serviceOffering.findMany.mockResolvedValue([matchingOffering]);
        tx.leadSignal.count.mockResolvedValue(3); // já tem sinais de uma investigação anterior

        const gateways = fakeGateways();
        gateways.apify.searchBusinesses.mockResolvedValue([apifyCandidateWithWebsite()]);
        gateways.explorium.matchBusiness.mockResolvedValue(matchBusinessResultWithWebsite);
        gateways.camofox.search.mockResolvedValue([
          { title: 'WhatsApp', url: 'https://wa.me/5519999999999', textContent: null, raw: {} },
        ]);

        const enqueueAutodraft = jest.fn().mockResolvedValue(undefined);
        const enqueueWebsiteProfile = jest.fn().mockResolvedValue(undefined);
        await processLeadScrapeJob(
          prisma as never,
          gateways as never,
          fakeRedis as never,
          jobData,
          enqueueAutodraft,
          enqueueWebsiteProfile,
        );

        expect(enqueueWebsiteProfile).not.toHaveBeenCalled();
        expect(enqueueAutodraft).toHaveBeenCalledTimes(1);
      });

      it('teto de investigação por job (15) respeitado — excedente cai de volta no autodraft imediato', async () => {
        const tx = setupTx();
        const prisma = buildPrisma();
        setupQualifyingRun(tx, prisma);
        prisma.scrapeJob.findFirstOrThrow.mockResolvedValue({ ...baseScrapeJob, onlyWithoutWebsite: false });
        tx.serviceOffering.findMany.mockResolvedValue([matchingOffering]);
        tx.leadSignal.count.mockResolvedValue(0); // nenhum dos 16 foi investigado ainda

        const gateways = fakeGateways();
        const candidates = Array.from({ length: 16 }, (_, i) =>
          apifyCandidateWithWebsite({ placeId: `place-${i}` }),
        );
        gateways.apify.searchBusinesses.mockResolvedValue(candidates);
        gateways.explorium.matchBusiness.mockResolvedValue(matchBusinessResultWithWebsite);
        gateways.camofox.search.mockResolvedValue([
          { title: 'WhatsApp', url: 'https://wa.me/5519999999999', textContent: null, raw: {} },
        ]);

        const enqueueAutodraft = jest.fn().mockResolvedValue(undefined);
        const enqueueWebsiteProfile = jest.fn().mockResolvedValue(undefined);
        const result = await processLeadScrapeJob(
          prisma as never,
          gateways as never,
          fakeRedis as never,
          jobData,
          enqueueAutodraft,
          enqueueWebsiteProfile,
        );

        expect(tx.lead.upsert).toHaveBeenCalledTimes(16); // todos os 16 leads são persistidos normalmente
        expect(enqueueWebsiteProfile).toHaveBeenCalledTimes(15); // teto de investigação por job
        expect(enqueueAutodraft).toHaveBeenCalledTimes(1); // o 16º, que excedeu o teto, cai no autodraft imediato
        expect(result.status).toBe('COMPLETED');
      });
    });
  });

  describe('roteamento automático (round-robin, Trilha B)', () => {
    function apifyBusiness(overrides: { name: string; placeId: string }) {
      return {
        name: overrides.name,
        address: null,
        city: 'Campinas',
        state: 'SP',
        phone: null,
        website: null,
        googleCategory: 'Padaria',
        rating: 4.5,
        reviewCount: 20,
        placeId: overrides.placeId,
        raw: {},
      };
    }

    it('atribui o lead recém-criado ao membro com menos leads em aberto', async () => {
      const tx = setupTx();
      (isOverBudget as jest.Mock).mockResolvedValue(false);
      const prisma = buildPrisma();
      prisma.scrapeJob.findFirstOrThrow.mockResolvedValue(baseScrapeJob);
      prisma.organization.findUniqueOrThrow.mockResolvedValue({ scrapingMonthlyBudget: null });
      tx.scrapeJob.update.mockResolvedValue({ ...baseScrapeJob, status: 'COMPLETED' });
      tx.lead.upsert.mockImplementation((args: { create: Record<string, unknown> }) =>
        Promise.resolve({ id: 'lead-1', assignedUserId: null, ...args.create }),
      );
      tx.membership.findMany.mockResolvedValue([{ userId: 'user-a' }, { userId: 'user-b' }]);
      tx.lead.groupBy.mockResolvedValue([
        { assignedUserId: 'user-a', _count: { _all: 5 } },
        { assignedUserId: 'user-b', _count: { _all: 1 } },
      ]);
      tx.lead.update.mockResolvedValue({ id: 'lead-1', assignedUserId: 'user-b' });

      const gateways = fakeGateways();
      gateways.apify.searchBusinesses.mockResolvedValue([apifyBusiness({ name: 'Padaria Sem Site', placeId: 'place-1' })]);
      gateways.explorium.matchBusiness.mockResolvedValue(null);

      await processLeadScrapeJob(prisma as never, gateways as never, fakeRedis as never, jobData);

      expect(tx.membership.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId: 'org-1', role: { in: ['OWNER', 'ADMIN', 'MANAGER', 'MEMBER'] } },
        }),
      );
      expect(tx.lead.update).toHaveBeenCalledWith({ where: { id: 'lead-1' }, data: { assignedUserId: 'user-b' } });
    });

    it('nunca reatribui um lead que já tem dono (re-scan de lead existente)', async () => {
      const tx = setupTx();
      (isOverBudget as jest.Mock).mockResolvedValue(false);
      const prisma = buildPrisma();
      prisma.scrapeJob.findFirstOrThrow.mockResolvedValue(baseScrapeJob);
      prisma.organization.findUniqueOrThrow.mockResolvedValue({ scrapingMonthlyBudget: null });
      tx.scrapeJob.update.mockResolvedValue({ ...baseScrapeJob, status: 'COMPLETED' });
      tx.lead.upsert.mockImplementation((args: { create: Record<string, unknown> }) =>
        Promise.resolve({ id: 'lead-1', assignedUserId: 'user-ja-dono', ...args.create }),
      );
      tx.membership.findMany.mockResolvedValue([{ userId: 'user-a' }]);

      const gateways = fakeGateways();
      gateways.apify.searchBusinesses.mockResolvedValue([apifyBusiness({ name: 'Padaria Sem Site', placeId: 'place-1' })]);
      gateways.explorium.matchBusiness.mockResolvedValue(null);

      await processLeadScrapeJob(prisma as never, gateways as never, fakeRedis as never, jobData);

      expect(tx.lead.update).not.toHaveBeenCalled();
    });

    it('sem nenhum membro elegível, não chama lead.groupBy nem lead.update (nunca lança erro)', async () => {
      const tx = setupTx();
      (isOverBudget as jest.Mock).mockResolvedValue(false);
      const prisma = buildPrisma();
      prisma.scrapeJob.findFirstOrThrow.mockResolvedValue(baseScrapeJob);
      prisma.organization.findUniqueOrThrow.mockResolvedValue({ scrapingMonthlyBudget: null });
      tx.scrapeJob.update.mockResolvedValue({ ...baseScrapeJob, status: 'COMPLETED' });
      tx.lead.upsert.mockImplementation((args: { create: Record<string, unknown> }) =>
        Promise.resolve({ id: 'lead-1', assignedUserId: null, ...args.create }),
      );
      tx.membership.findMany.mockResolvedValue([]);

      const gateways = fakeGateways();
      gateways.apify.searchBusinesses.mockResolvedValue([apifyBusiness({ name: 'Padaria Sem Site', placeId: 'place-1' })]);
      gateways.explorium.matchBusiness.mockResolvedValue(null);

      const result = await processLeadScrapeJob(prisma as never, gateways as never, fakeRedis as never, jobData);

      expect(tx.lead.groupBy).not.toHaveBeenCalled();
      expect(tx.lead.update).not.toHaveBeenCalled();
      expect(result.status).toBe('COMPLETED');
    });

    it('distribui leads novos do mesmo lote entre os membros elegíveis (contagem em memória, não só no banco)', async () => {
      const tx = setupTx();
      (isOverBudget as jest.Mock).mockResolvedValue(false);
      const prisma = buildPrisma();
      prisma.scrapeJob.findFirstOrThrow.mockResolvedValue(baseScrapeJob);
      prisma.organization.findUniqueOrThrow.mockResolvedValue({ scrapingMonthlyBudget: null });
      tx.scrapeJob.update.mockResolvedValue({ ...baseScrapeJob, status: 'COMPLETED' });
      let created = 0;
      tx.lead.upsert.mockImplementation((args: { create: Record<string, unknown> }) => {
        created += 1;
        return Promise.resolve({ id: `lead-${created}`, assignedUserId: null, ...args.create });
      });
      tx.membership.findMany.mockResolvedValue([{ userId: 'user-a' }, { userId: 'user-b' }]);
      tx.lead.groupBy.mockResolvedValue([]); // os dois começam com 0 em aberto
      tx.lead.update.mockImplementation(
        (args: { where: { id: string }; data: { assignedUserId: string } }) =>
          Promise.resolve({ id: args.where.id, assignedUserId: args.data.assignedUserId }),
      );

      const gateways = fakeGateways();
      gateways.apify.searchBusinesses.mockResolvedValue([
        apifyBusiness({ name: 'Padaria A', placeId: 'place-1' }),
        apifyBusiness({ name: 'Padaria B', placeId: 'place-2' }),
      ]);
      gateways.explorium.matchBusiness.mockResolvedValue(null);

      await processLeadScrapeJob(prisma as never, gateways as never, fakeRedis as never, jobData);

      // Empate no início (0 e 0): user-a vence a 1ª vez (primeiro da lista);
      // com a contagem incrementada em memória (não reconsultando o banco a
      // cada lead), user-b vence a 2ª — sem isso, todo o lote inteiro cairia
      // sempre no mesmo membro.
      const assignedTo = (tx.lead.update as jest.Mock).mock.calls.map(
        (call) => (call[0] as { data: { assignedUserId: string } }).data.assignedUserId,
      );
      expect(assignedTo).toEqual(['user-a', 'user-b']);
    });
  });

  describe('Passo 1 tolera lag de commit entre API e worker (retry em P2025)', () => {
    // Regressão real achada pela revisão final: `ScrapeJobsService.create()`
    // enfileira no Redis DENTRO da transação Postgres da request (antes do
    // commit) — o worker pode pegar o job e tentar `tx.scrapeJob.update`
    // antes da linha existir de verdade, levando P2025. Sem retry, o catch
    // externo também falhava (mesma linha inexistente) e o job ficava
    // QUEUED pra sempre.
    it('P2025 nas primeiras tentativas, depois a linha aparece => retry absorve e o job completa normalmente', async () => {
      const tx = setupTx();
      (isOverBudget as jest.Mock).mockResolvedValue(false);
      const prisma = buildPrisma();
      prisma.scrapeJob.findFirstOrThrow.mockResolvedValue(baseScrapeJob);
      prisma.organization.findUniqueOrThrow.mockResolvedValue({ scrapingMonthlyBudget: null });
      let updateCalls = 0;
      tx.scrapeJob.update.mockImplementation((args: { data: { status?: string } }) => {
        updateCalls += 1;
        if (updateCalls <= 2) {
          return Promise.reject({ code: 'P2025' });
        }
        return Promise.resolve({ ...baseScrapeJob, status: args.data.status ?? 'RUNNING' });
      });
      tx.lead.upsert.mockImplementation((args: { create: Record<string, unknown> }) =>
        Promise.resolve({ id: 'lead-1', ...args.create }),
      );

      const gateways = fakeGateways();
      // 3 candidatos — cobre o suficiente, sem disparar o fallback
      // Apify→Camofox (não é o que este teste investiga).
      gateways.apify.searchBusinesses.mockResolvedValue(
        ['place-1', 'place-2', 'place-3'].map((placeId) => ({
          name: `Padaria ${placeId}`,
          address: null,
          city: 'Campinas',
          state: 'SP',
          phone: null,
          website: null,
          googleCategory: 'Padaria',
          rating: 4.5,
          reviewCount: 20,
          placeId,
          raw: {},
        })),
      );
      gateways.explorium.matchBusiness.mockResolvedValue(null);

      const result = await processLeadScrapeJob(prisma as never, gateways as never, fakeRedis as never, jobData);

      // 2 tentativas P2025 (Passo 1) + 1 sucesso (Passo 1) + 1 chamada final
      // (Passo 4, status terminal) = pelo menos 4.
      expect(updateCalls).toBeGreaterThanOrEqual(4);
      expect(result.status).toBe('COMPLETED');
    });

    it('P2025 persiste em todas as tentativas => desiste e marca FAILED (nunca fica pendurado em QUEUED/RUNNING)', async () => {
      setupTx();
      const prisma = buildPrisma();
      prisma.scrapeJob.findFirstOrThrow.mockResolvedValue(baseScrapeJob);
      prisma.scrapeJob.update.mockResolvedValue({ ...baseScrapeJob, status: 'FAILED' });
      const { withTenantContext } = jest.requireMock('./tenant-context');
      withTenantContext.mockImplementation((_p: unknown, _o: string, fn: (tx: unknown) => unknown) =>
        fn({ scrapeJob: { update: jest.fn().mockRejectedValue({ code: 'P2025' }) } }),
      );

      const result = await processLeadScrapeJob(
        prisma as never,
        fakeGateways() as never,
        fakeRedis as never,
        jobData,
      );

      expect(result.status).toBe('FAILED');
      expect(prisma.scrapeJob.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'scrape-1' }, data: expect.objectContaining({ status: 'FAILED' }) }),
      );
    });
  });

  describe('fallback automático Apify → Camofox', () => {
    function fakeEnqueueFallbackScrape() {
      return jest.fn().mockResolvedValue(undefined);
    }

    it('Apify retorna poucos resultados brutos => cria e enfileira um ScrapeJob Camofox como fallback', async () => {
      const tx = setupTx();
      (isOverBudget as jest.Mock).mockResolvedValue(false);
      const prisma = buildPrisma();
      prisma.scrapeJob.findFirstOrThrow.mockResolvedValue(baseScrapeJob);
      prisma.organization.findUniqueOrThrow.mockResolvedValue({ scrapingMonthlyBudget: null });
      prisma.scrapeJob.findFirst.mockResolvedValue(null); // nenhum fallback já existe
      prisma.scrapeJob.create.mockResolvedValue({ id: 'fallback-job-1' });
      tx.scrapeJob.update.mockResolvedValue({ ...baseScrapeJob, status: 'COMPLETED' });
      tx.lead.upsert.mockImplementation((args: { create: Record<string, unknown> }) =>
        Promise.resolve({ id: 'lead-1', ...args.create }),
      );

      const gateways = fakeGateways();
      // Só 1 resultado bruto (< limiar de cobertura) — Apify "não cobriu" a
      // região/tipo de negócio.
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
      const enqueueFallbackScrape = fakeEnqueueFallbackScrape();

      await processLeadScrapeJob(
        prisma as never,
        gateways as never,
        fakeRedis as never,
        jobData,
        undefined,
        undefined,
        enqueueFallbackScrape,
      );

      expect(prisma.scrapeJob.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organizationId: 'org-1',
            sourceType: 'CAMOFOX_GOOGLE_SEARCH',
            city: 'Campinas',
            state: 'SP',
            businessType: 'padaria',
            fallbackOfScrapeJobId: 'scrape-1',
          }),
        }),
      );
      expect(enqueueFallbackScrape).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: 'org-1', scrapeJobId: 'fallback-job-1' }),
      );
    });

    it('Apify cobre o suficiente => não cria nenhum fallback', async () => {
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
      gateways.apify.searchBusinesses.mockResolvedValue(
        ['place-1', 'place-2', 'place-3'].map((placeId) => ({
          name: `Padaria ${placeId}`,
          address: null,
          city: 'Campinas',
          state: 'SP',
          phone: null,
          website: null,
          googleCategory: 'Padaria',
          rating: 4.5,
          reviewCount: 20,
          placeId,
          raw: {},
        })),
      );
      gateways.explorium.matchBusiness.mockResolvedValue(null);
      const enqueueFallbackScrape = fakeEnqueueFallbackScrape();

      await processLeadScrapeJob(
        prisma as never,
        gateways as never,
        fakeRedis as never,
        jobData,
        undefined,
        undefined,
        enqueueFallbackScrape,
      );

      expect(prisma.scrapeJob.create).not.toHaveBeenCalled();
      expect(enqueueFallbackScrape).not.toHaveBeenCalled();
    });

    it('job com limit baixo (ex.: 2) e Apify cobre esse limite por completo => não cria fallback à toa', async () => {
      // Regressão achada pela revisão final: o limiar fixo de 3 ignorava
      // `scrapeJob.limit` — um job com limit:2 NUNCA "cobria o suficiente"
      // pela métrica antiga, mesmo com cobertura perfeita da região.
      const tx = setupTx();
      (isOverBudget as jest.Mock).mockResolvedValue(false);
      const prisma = buildPrisma();
      prisma.scrapeJob.findFirstOrThrow.mockResolvedValue({ ...baseScrapeJob, limit: 2 });
      prisma.organization.findUniqueOrThrow.mockResolvedValue({ scrapingMonthlyBudget: null });
      tx.scrapeJob.update.mockResolvedValue({ ...baseScrapeJob, status: 'COMPLETED' });
      tx.lead.upsert.mockImplementation((args: { create: Record<string, unknown> }) =>
        Promise.resolve({ id: 'lead-1', ...args.create }),
      );

      const gateways = fakeGateways();
      gateways.apify.searchBusinesses.mockResolvedValue(
        ['place-1', 'place-2'].map((placeId) => ({
          name: `Padaria ${placeId}`,
          address: null,
          city: 'Campinas',
          state: 'SP',
          phone: null,
          website: null,
          googleCategory: 'Padaria',
          rating: 4.5,
          reviewCount: 20,
          placeId,
          raw: {},
        })),
      );
      gateways.explorium.matchBusiness.mockResolvedValue(null);
      const enqueueFallbackScrape = fakeEnqueueFallbackScrape();

      await processLeadScrapeJob(
        prisma as never,
        gateways as never,
        fakeRedis as never,
        jobData,
        undefined,
        undefined,
        enqueueFallbackScrape,
      );

      expect(prisma.scrapeJob.create).not.toHaveBeenCalled();
      expect(enqueueFallbackScrape).not.toHaveBeenCalled();
    });

    it('já existe um fallback pra este job origem (ex.: retry do BullMQ) => não cria outro', async () => {
      const tx = setupTx();
      (isOverBudget as jest.Mock).mockResolvedValue(false);
      const prisma = buildPrisma();
      prisma.scrapeJob.findFirstOrThrow.mockResolvedValue(baseScrapeJob);
      prisma.organization.findUniqueOrThrow.mockResolvedValue({ scrapingMonthlyBudget: null });
      prisma.scrapeJob.findFirst.mockResolvedValue({ id: 'ja-existe' });
      tx.scrapeJob.update.mockResolvedValue({ ...baseScrapeJob, status: 'COMPLETED' });
      tx.lead.upsert.mockImplementation((args: { create: Record<string, unknown> }) =>
        Promise.resolve({ id: 'lead-1', ...args.create }),
      );

      const gateways = fakeGateways();
      gateways.apify.searchBusinesses.mockResolvedValue([]);
      const enqueueFallbackScrape = fakeEnqueueFallbackScrape();

      await processLeadScrapeJob(
        prisma as never,
        gateways as never,
        fakeRedis as never,
        jobData,
        undefined,
        undefined,
        enqueueFallbackScrape,
      );

      expect(prisma.scrapeJob.create).not.toHaveBeenCalled();
      expect(enqueueFallbackScrape).not.toHaveBeenCalled();
    });

    it('job que já é ele mesmo um fallback nunca dispara outro fallback (defesa contra encadeamento)', async () => {
      const tx = setupTx();
      (isOverBudget as jest.Mock).mockResolvedValue(false);
      const prisma = buildPrisma();
      // Cenário hipotético defensivo: mesmo que um APIFY_GOOGLE_MAPS algum
      // dia carregasse fallbackOfScrapeJobId, a checagem explícita no worker
      // nunca deveria deixar isto encadear um segundo fallback.
      prisma.scrapeJob.findFirstOrThrow.mockResolvedValue({
        ...baseScrapeJob,
        fallbackOfScrapeJobId: 'origem-1',
      });
      prisma.organization.findUniqueOrThrow.mockResolvedValue({ scrapingMonthlyBudget: null });
      tx.scrapeJob.update.mockResolvedValue({ ...baseScrapeJob, status: 'COMPLETED' });
      tx.lead.upsert.mockImplementation((args: { create: Record<string, unknown> }) =>
        Promise.resolve({ id: 'lead-1', ...args.create }),
      );

      const gateways = fakeGateways();
      gateways.apify.searchBusinesses.mockResolvedValue([]);
      const enqueueFallbackScrape = fakeEnqueueFallbackScrape();

      await processLeadScrapeJob(
        prisma as never,
        gateways as never,
        fakeRedis as never,
        jobData,
        undefined,
        undefined,
        enqueueFallbackScrape,
      );

      expect(prisma.scrapeJob.create).not.toHaveBeenCalled();
      expect(enqueueFallbackScrape).not.toHaveBeenCalled();
    });
  });
});
