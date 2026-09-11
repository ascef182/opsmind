import { scanProspectingTargets } from './prospecting-scan';

describe('scanProspectingTargets', () => {
  function buildPrisma() {
    return {
      prospectingTarget: { findMany: jest.fn() },
      scrapeJob: { findFirst: jest.fn(), create: jest.fn() },
      auditLog: { create: jest.fn() },
    };
  }

  function buildRedis(spend: string | null = null) {
    return {
      get: jest.fn().mockResolvedValue(spend),
    };
  }

  function buildTarget(overrides: Record<string, unknown> = {}) {
    return {
      id: 'target-1',
      organizationId: 'org-1',
      city: 'São Paulo',
      state: 'SP',
      businessType: 'restaurante',
      sourceType: 'APIFY_GOOGLE_MAPS',
      onlyWithoutWebsite: true,
      limit: 50,
      isActive: true,
      cooldownDays: 7,
      organization: { scrapingMonthlyBudget: null },
      ...overrides,
    };
  }

  it('(a) cria um ScrapeJob para um target ativo sem ScrapeJob COMPLETED recente', async () => {
    const prisma = buildPrisma();
    const redis = buildRedis();
    prisma.prospectingTarget.findMany.mockResolvedValue([buildTarget()]);
    prisma.scrapeJob.findFirst.mockResolvedValue(null);
    prisma.scrapeJob.create.mockResolvedValue({ id: 'job-1' });
    const enqueue = jest.fn();

    const count = await scanProspectingTargets(prisma as never, redis as never, enqueue);

    expect(prisma.prospectingTarget.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      include: { organization: true },
    });
    expect(prisma.scrapeJob.create).toHaveBeenCalledWith({
      data: {
        organizationId: 'org-1',
        sourceType: 'APIFY_GOOGLE_MAPS',
        city: 'São Paulo',
        state: 'SP',
        businessType: 'restaurante',
        onlyWithoutWebsite: true,
        limit: 50,
        status: 'QUEUED',
        actorType: 'SYSTEM',
        actorId: null,
      },
    });
    expect(enqueue).toHaveBeenCalledWith(
      { id: 'job-1' },
      { organizationId: 'org-1', scrapeJobId: 'job-1', actorType: 'SYSTEM' },
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        organizationId: 'org-1',
        actorType: 'SYSTEM',
        actorId: null,
        action: 'scrape_job.created',
        resource: 'ScrapeJob:job-1',
        metadata: { trigger: 'prospecting_scan', prospectingTargetId: 'target-1' },
      },
    });
    expect(count).toBe(1);
  });

  it('(b) pula target com ScrapeJob equivalente dentro do cooldown — COMPLETED, QUEUED ou RUNNING', async () => {
    const prisma = buildPrisma();
    const redis = buildRedis();
    prisma.prospectingTarget.findMany.mockResolvedValue([buildTarget({ cooldownDays: 7 })]);
    prisma.scrapeJob.findFirst.mockResolvedValue({ id: 'job-old' });
    const enqueue = jest.fn();

    const count = await scanProspectingTargets(prisma as never, redis as never, enqueue);

    expect(prisma.scrapeJob.findFirst).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-1',
        city: 'São Paulo',
        state: 'SP',
        businessType: 'restaurante',
        sourceType: 'APIFY_GOOGLE_MAPS',
        // QUEUED/RUNNING entram junto de COMPLETED: um job equivalente ainda
        // em voo também suprime a criação de um novo (senão cada tick criaria
        // — e pagaria por — um job duplicado até o primeiro terminar).
        status: { in: ['COMPLETED', 'QUEUED', 'RUNNING'] },
        createdAt: { gt: expect.any(Date) },
      },
    });
    expect(prisma.scrapeJob.create).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
    expect(count).toBe(0);
  });

  it('(b2) FAILED nunca suprime: não está entre os status do cooldown, então o próximo tick pode retentar', async () => {
    const prisma = buildPrisma();
    const redis = buildRedis();
    prisma.prospectingTarget.findMany.mockResolvedValue([buildTarget()]);
    // A query real filtra por status — um job FAILED recente simplesmente não
    // é retornado por ela, então o scan segue e cria um job novo.
    prisma.scrapeJob.findFirst.mockResolvedValue(null);
    prisma.scrapeJob.create.mockResolvedValue({ id: 'job-retry' });
    const enqueue = jest.fn();

    const count = await scanProspectingTargets(prisma as never, redis as never, enqueue);

    const statusFilter = prisma.scrapeJob.findFirst.mock.calls[0][0].where.status;
    expect(statusFilter.in).not.toContain('FAILED');
    expect(prisma.scrapeJob.create).toHaveBeenCalledTimes(1);
    expect(count).toBe(1);
  });

  it('(c) cria de novo quando não há ScrapeJob COMPLETED dentro da janela de cooldown do target', async () => {
    const prisma = buildPrisma();
    const redis = buildRedis();
    prisma.prospectingTarget.findMany.mockResolvedValue([buildTarget({ cooldownDays: 1 })]);
    // Fora da janela: a query (filtrando createdAt > cutoff) não encontra nada.
    prisma.scrapeJob.findFirst.mockResolvedValue(null);
    prisma.scrapeJob.create.mockResolvedValue({ id: 'job-2' });

    const count = await scanProspectingTargets(prisma as never, redis as never, jest.fn());

    const cutoffUsed = prisma.scrapeJob.findFirst.mock.calls[0][0].where.createdAt.gt as Date;
    const expectedCutoff = new Date(Date.now() - 1 * 86_400_000);
    // Tolerância de alguns segundos (teste e código rodam em momentos ligeiramente diferentes).
    expect(Math.abs(cutoffUsed.getTime() - expectedCutoff.getTime())).toBeLessThan(5000);
    expect(prisma.scrapeJob.create).toHaveBeenCalledTimes(1);
    expect(count).toBe(1);
  });

  it('(d) pula sem criar ScrapeJob quando o orçamento mensal de scraping já foi estourado', async () => {
    const prisma = buildPrisma();
    const redis = buildRedis('999');
    prisma.prospectingTarget.findMany.mockResolvedValue([
      buildTarget({ organization: { scrapingMonthlyBudget: 10 } }),
    ]);
    prisma.scrapeJob.findFirst.mockResolvedValue(null);
    const enqueue = jest.fn();

    const count = await scanProspectingTargets(prisma as never, redis as never, enqueue);

    expect(prisma.scrapeJob.create).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
    expect(count).toBe(0);
  });

  it('(e) aplica o teto de 5 ScrapeJobs por organização por tick — o 6º target da mesma org não cria job', async () => {
    const prisma = buildPrisma();
    const redis = buildRedis();
    const targets = Array.from({ length: 6 }, (_, i) => buildTarget({ id: `target-${i}`, city: `Cidade ${i}` }));
    prisma.prospectingTarget.findMany.mockResolvedValue(targets);
    prisma.scrapeJob.findFirst.mockResolvedValue(null);
    let jobCounter = 0;
    prisma.scrapeJob.create.mockImplementation(() => Promise.resolve({ id: `job-${jobCounter++}` }));

    const count = await scanProspectingTargets(prisma as never, redis as never, jest.fn());

    expect(prisma.scrapeJob.create).toHaveBeenCalledTimes(5);
    expect(count).toBe(5);
  });

  it('(f) nunca considera ProspectingTargets com isActive: false (filtrado na própria query)', async () => {
    const prisma = buildPrisma();
    const redis = buildRedis();
    // A query real já filtra isActive: true — um target inativo nunca chega
    // a ser retornado pelo Prisma, então o mock devolve a lista vazia.
    prisma.prospectingTarget.findMany.mockResolvedValue([]);

    const count = await scanProspectingTargets(prisma as never, redis as never, jest.fn());

    expect(prisma.prospectingTarget.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true } }),
    );
    expect(prisma.scrapeJob.create).not.toHaveBeenCalled();
    expect(count).toBe(0);
  });

  it('continua processando os demais targets quando um deles falha (try/catch por target)', async () => {
    const prisma = buildPrisma();
    const redis = buildRedis();
    prisma.prospectingTarget.findMany.mockResolvedValue([
      buildTarget({ id: 'target-broken', city: 'Cidade Quebrada' }),
      buildTarget({ id: 'target-ok', city: 'Cidade OK' }),
    ]);
    prisma.scrapeJob.findFirst.mockResolvedValue(null);
    prisma.scrapeJob.create
      .mockRejectedValueOnce(new Error('falha simulada no primeiro target'))
      .mockResolvedValueOnce({ id: 'job-ok' });

    const count = await scanProspectingTargets(prisma as never, redis as never, jest.fn());

    expect(prisma.scrapeJob.create).toHaveBeenCalledTimes(2);
    expect(count).toBe(1);
  });
});
