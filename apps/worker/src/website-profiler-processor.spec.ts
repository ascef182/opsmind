jest.mock('./tenant-context', () => ({
  withTenantContext: jest.fn((_prisma: unknown, _orgId: string, fn: (tx: unknown) => unknown) => fn('TX')),
}));
jest.mock('./ssrf-safe-fetch', () => ({
  ...jest.requireActual('./ssrf-safe-fetch'),
  ssrfSafeFetch: jest.fn(),
}));

import { processWebsiteProfileJob } from './website-profiler-processor';
import { withTenantContext } from './tenant-context';
import { ssrfSafeFetch, SsrfSafeFetchError } from './ssrf-safe-fetch';

const jobData = { organizationId: 'org-1', leadId: 'lead-1', actorType: 'USER' as const, actorId: 'user-1' };

const currentYear = new Date().getUTCFullYear();

function buildLead(overrides: Record<string, unknown> = {}) {
  return {
    id: 'lead-1',
    organizationId: 'org-1',
    website: 'https://exemplo.com.br',
    status: 'DISCOVERED',
    googleCategory: null,
    rating: null,
    reviewCount: null,
    rawContent: null,
    sourceType: 'MANUAL',
    whatsapp: null,
    email: null,
    phone: null,
    socialLinks: null,
    ...overrides,
  };
}

// Mesma offering usada em todos os testes de autodraft pós-investigação
// abaixo: sem restrição de faixa (`min/maxEmployees`/`min/maxRevenueUsd`
// todos `null`), então qualquer `employeeCount`/`revenueUsd` não-nulo já
// "bate" — basta o setor (`targetIndustries`) casar com a firmografia pra
// fechar os 3 pontos de match do icpFit (30 pts) + os 20 pts de atividade
// (rating/reviewCount, ver `buildLead` acima) = 50, o suficiente pra cruzar
// `QUALIFICATION_THRESHOLD` sem depender de `hasNoWebsitePoints` (que não
// se aplica aqui — o lead TEM site, é o ponto desta função).
const autodraftMatchingOffering = {
  id: 'offering-1',
  signals: [] as string[],
  targetIndustries: ['Padaria'],
  minEmployees: null,
  maxEmployees: null,
  minRevenueUsd: null,
  maxRevenueUsd: null,
};

function buildQualifyingFirmographicsEnrichment() {
  return {
    data: { industry: 'Padaria', employeeCount: 8, revenueUsd: 500_000 },
  };
}

function buildTx() {
  return {
    leadSignal: {
      upsert: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    leadEnrichment: { create: jest.fn(), findFirst: jest.fn().mockResolvedValue(null) },
    serviceOffering: { findMany: jest.fn().mockResolvedValue([]) },
    // Default: todo código candidato é considerado governado/confirmado
    // (ecoa de volta `where.code.in`) — testes que não são sobre governança
    // de vocabulário não precisam mockar isto explicitamente. Testes que
    // SÃO sobre isso (ex.: código DEPRECATED) sobrescrevem este mock.
    signalCode: {
      findMany: jest.fn(({ where }: { where: { code: { in: string[] } } }) =>
        Promise.resolve(where.code.in.map((code) => ({ code }))),
      ),
    },
    lead: { update: jest.fn() },
    auditLog: { create: jest.fn() },
    outreachMessage: { count: jest.fn().mockResolvedValue(0) },
    pipelineStageTransition: { create: jest.fn() },
    harveyActivity: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'act-1', ...data })),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'act-1', ...data })),
      upsert: jest.fn(async ({ create }: { create: Record<string, unknown> }) => ({ id: 'evt-1', ...create })),
    },
    harveyRun: { update: jest.fn() },
  };
}

function setupTx() {
  const tx = buildTx();
  (withTenantContext as jest.Mock).mockImplementation((_p: unknown, _o: string, fn: (tx: unknown) => unknown) =>
    fn(tx),
  );
  return tx;
}

function buildPrisma(lead: unknown = buildLead(), controlState: 'ACTIVE' | 'PAUSED' | 'STOPPED' = 'ACTIVE') {
  return {
    lead: { findFirst: jest.fn().mockResolvedValue(lead) },
    harveyAgent: { findUnique: jest.fn().mockResolvedValue({ controlState }) },
  };
}

describe('processWebsiteProfileJob', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('não faz nada quando o lead não tem website conhecido', async () => {
    const prisma = buildPrisma(buildLead({ website: null }));
    await processWebsiteProfileJob(prisma as never, jobData);
    expect(ssrfSafeFetch).not.toHaveBeenCalled();
    expect(withTenantContext).not.toHaveBeenCalled();
  });

  it('lança quando o lead não existe na organização', async () => {
    const prisma = buildPrisma(null);
    await expect(processWebsiteProfileJob(prisma as never, jobData)).rejects.toThrow();
  });

  it('não grava nada quando a busca da homepage falha (SSRF/timeout/DNS), só a atividade como FAILED', async () => {
    const tx = setupTx();
    const prisma = buildPrisma();
    (ssrfSafeFetch as jest.Mock).mockRejectedValue(new SsrfSafeFetchError('bloqueado'));

    await processWebsiteProfileJob(prisma as never, jobData);

    expect(tx.leadSignal.upsert).not.toHaveBeenCalled();
    expect(tx.lead.update).not.toHaveBeenCalled();
    expect(tx.harveyActivity.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }),
    );
  });

  describe('Harvey', () => {
    const automatic = { ...jobData, actorType: 'SYSTEM' as const, actorId: undefined, trigger: 'AUTOMATIC' as const };

    it('skips with SKIPPED activity when paused', async () => {
      const tx = setupTx();
      const prisma = buildPrisma(buildLead(), 'PAUSED');
      await processWebsiteProfileJob(prisma as never, automatic);
      expect(ssrfSafeFetch).not.toHaveBeenCalled();
      expect(tx.harveyActivity.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ type: 'research.site_analysis', status: 'SKIPPED' }),
        }),
      );
    });

    it('a manual analysis runs even while Harvey is paused', async () => {
      setupTx();
      const prisma = buildPrisma(buildLead(), 'PAUSED');
      (ssrfSafeFetch as jest.Mock).mockRejectedValue(new SsrfSafeFetchError('bloqueado'));
      await processWebsiteProfileJob(prisma as never, { ...jobData, trigger: 'MANUAL' });
      expect(ssrfSafeFetch).toHaveBeenCalled();
    });
  });

  it('propaga um erro que NÃO é SsrfSafeFetchError (não é condição esperada, deve subir)', async () => {
    const prisma = buildPrisma();
    (ssrfSafeFetch as jest.Mock).mockRejectedValue(new Error('erro inesperado de verdade'));

    await expect(processWebsiteProfileJob(prisma as never, jobData)).rejects.toThrow('erro inesperado de verdade');
  });

  it('busca homepage + /contato, extrai sinais, grava LeadSignal com runId consistente, LeadEnrichment e recalcula o score', async () => {
    const prisma = buildPrisma();
    const tx = setupTx();
    (ssrfSafeFetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        finalUrl: 'http://exemplo.com.br/', // http, não https => website.no_ssl
        body: `<footer>© ${currentYear - 3} Exemplo</footer>`,
      })
      .mockResolvedValueOnce({ ok: true, status: 200, finalUrl: 'http://exemplo.com.br/contato', body: '<html></html>' });

    await processWebsiteProfileJob(prisma as never, jobData);

    expect(ssrfSafeFetch).toHaveBeenCalledTimes(2);
    expect(ssrfSafeFetch).toHaveBeenNthCalledWith(1, 'https://exemplo.com.br');

    expect(tx.leadSignal.upsert).toHaveBeenCalled();
    const calls = tx.leadSignal.upsert.mock.calls;
    const runIds = new Set(calls.map((call: unknown[]) => (call[0] as { create: { runId: string } }).create.runId));
    expect(runIds.size).toBe(1); // mesmo runId em todas as linhas desta execução

    const signalCodes = calls.map((call: unknown[]) => (call[0] as { create: { signalCode: string } }).create.signalCode);
    expect(signalCodes).toContain('website.no_ssl');
    expect(signalCodes).toContain('website.outdated_copyright_year');
    expect(signalCodes.every((code: string) => code)).toBe(true);

    expect(tx.leadEnrichment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: 'org-1',
          leadId: 'lead-1',
          type: 'website_profile',
        }),
      }),
    );

    expect(tx.lead.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'lead-1' },
        data: expect.objectContaining({ status: expect.any(String) }),
      }),
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'website_profile.finished' }) }),
    );
  });

  it('segue com só a homepage quando a busca de /contato falha (melhor esforço, não aborta)', async () => {
    const prisma = buildPrisma();
    const tx = setupTx();
    (ssrfSafeFetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true, status: 200, finalUrl: 'https://exemplo.com.br/', body: '<html></html>' })
      .mockRejectedValueOnce(new SsrfSafeFetchError('contato bloqueado ou indisponível'));

    await processWebsiteProfileJob(prisma as never, jobData);

    expect(tx.leadEnrichment.create).toHaveBeenCalled();
    expect(tx.lead.update).toHaveBeenCalled();
  });

  it('carrega sinais confirmados só de collector WEBSITE_PROFILER/MANUAL para o recálculo de score (nunca AI_ANALYSIS)', async () => {
    const prisma = buildPrisma();
    const tx = setupTx();
    (ssrfSafeFetch as jest.Mock).mockResolvedValue({ ok: true, status: 200, finalUrl: 'https://exemplo.com.br/', body: '<html></html>' });

    await processWebsiteProfileJob(prisma as never, jobData);

    expect(tx.leadSignal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ collector: { in: ['WEBSITE_PROFILER', 'MANUAL'] } }),
      }),
    );
  });

  it('nunca regride Lead.status quando o lead já passou da qualificação inicial (ex.: CONTACTED)', async () => {
    const prisma = buildPrisma(buildLead({ status: 'CONTACTED' }));
    const tx = setupTx();
    (ssrfSafeFetch as jest.Mock).mockResolvedValue({ ok: true, status: 200, finalUrl: 'https://exemplo.com.br/', body: '<html></html>' });

    await processWebsiteProfileJob(prisma as never, jobData);

    const updateCall = tx.lead.update.mock.calls[0][0];
    expect(updateCall.data).not.toHaveProperty('status');
  });

  it('nunca grava um sinal cujo SignalCode está DEPRECATED, mesmo que a extração o detecte (governança de vocabulário)', async () => {
    const prisma = buildPrisma();
    const tx = setupTx();
    // html sem https, sem viewport, sem form, sem whatsapp => vários sinais
    // candidatos; simula `social.no_instagram`-like como DEPRECATED
    // (findMany some do resultado), as demais permanecem CONFIRMED.
    (ssrfSafeFetch as jest.Mock).mockResolvedValue({ ok: true, status: 200, finalUrl: 'http://exemplo.com.br/', body: '<html></html>' });
    (tx.signalCode.findMany as jest.Mock).mockImplementation(({ where }: { where: { code: { in: string[] } } }) =>
      Promise.resolve(
        where.code.in.filter((code: string) => code !== 'website.no_ssl').map((code: string) => ({ code })),
      ),
    );

    await processWebsiteProfileJob(prisma as never, jobData);

    const writtenCodes = tx.leadSignal.upsert.mock.calls.map(
      (call: unknown[]) => (call[0] as { create: { signalCode: string } }).create.signalCode,
    );
    expect(writtenCodes).not.toContain('website.no_ssl');
    expect(writtenCodes.length).toBeGreaterThan(0); // os demais sinais, não-deprecated, continuam sendo gravados
  });

  it('nunca lança (nem falha o job) quando a extração produz um código desconhecido/nunca proposto — só pula aquele sinal', async () => {
    const prisma = buildPrisma();
    const tx = setupTx();
    (ssrfSafeFetch as jest.Mock).mockResolvedValue({ ok: true, status: 200, finalUrl: 'http://exemplo.com.br/', body: '<html></html>' });
    // Nenhum código é reconhecido como governado (simula um código extraído
    // que nunca foi proposto/semeado) — nada deveria ser gravado, mas o job
    // não deve lançar.
    (tx.signalCode.findMany as jest.Mock).mockResolvedValue([]);

    await expect(processWebsiteProfileJob(prisma as never, jobData)).resolves.not.toThrow();
    expect(tx.leadSignal.upsert).not.toHaveBeenCalled();
  });

  describe('gatilho de autodraft PÓS-investigação (Fase 7)', () => {
    it('QUALIFIED + oferta sugerida + canal (WhatsApp) + zero outreach existente → enfileira o autodraft', async () => {
      const prisma = buildPrisma(buildLead({ rating: 4.5, reviewCount: 20, whatsapp: '5519999999999' }));
      const tx = setupTx();
      tx.leadEnrichment.findFirst.mockResolvedValue(buildQualifyingFirmographicsEnrichment());
      tx.serviceOffering.findMany.mockResolvedValue([autodraftMatchingOffering]);
      (ssrfSafeFetch as jest.Mock).mockResolvedValue({ ok: true, status: 200, finalUrl: 'https://exemplo.com.br/', body: '<html></html>' });

      const enqueueAutodraft = jest.fn().mockResolvedValue(undefined);
      await processWebsiteProfileJob(prisma as never, jobData, enqueueAutodraft);

      expect(enqueueAutodraft).toHaveBeenCalledTimes(1);
      expect(enqueueAutodraft).toHaveBeenCalledWith({
        trigger: 'AUTOMATIC',
        organizationId: 'org-1',
        leadId: 'lead-1',
        channel: 'WHATSAPP',
      });
    });

    it('QUALIFIED + oferta sugerida, mas SEM nenhum canal de contato resolvível → não enfileira', async () => {
      const prisma = buildPrisma(buildLead({ rating: 4.5, reviewCount: 20 })); // sem whatsapp/email/phone/socialLinks
      const tx = setupTx();
      tx.leadEnrichment.findFirst.mockResolvedValue(buildQualifyingFirmographicsEnrichment());
      tx.serviceOffering.findMany.mockResolvedValue([autodraftMatchingOffering]);
      (ssrfSafeFetch as jest.Mock).mockResolvedValue({ ok: true, status: 200, finalUrl: 'https://exemplo.com.br/', body: '<html></html>' });

      const enqueueAutodraft = jest.fn().mockResolvedValue(undefined);
      await processWebsiteProfileJob(prisma as never, jobData, enqueueAutodraft);

      expect(enqueueAutodraft).not.toHaveBeenCalled();
    });

    it('lead já tem OutreachMessage → nunca enfileira de novo, mesmo QUALIFIED com canal disponível', async () => {
      const prisma = buildPrisma(buildLead({ rating: 4.5, reviewCount: 20, whatsapp: '5519999999999' }));
      const tx = setupTx();
      tx.leadEnrichment.findFirst.mockResolvedValue(buildQualifyingFirmographicsEnrichment());
      tx.serviceOffering.findMany.mockResolvedValue([autodraftMatchingOffering]);
      tx.outreachMessage.count.mockResolvedValue(1);
      (ssrfSafeFetch as jest.Mock).mockResolvedValue({ ok: true, status: 200, finalUrl: 'https://exemplo.com.br/', body: '<html></html>' });

      const enqueueAutodraft = jest.fn().mockResolvedValue(undefined);
      await processWebsiteProfileJob(prisma as never, jobData, enqueueAutodraft);

      expect(tx.outreachMessage.count).toHaveBeenCalledWith({ where: { leadId: 'lead-1' } });
      expect(enqueueAutodraft).not.toHaveBeenCalled();
    });

    it('score fica abaixo do threshold (DISQUALIFIED) mesmo com canal disponível → não enfileira', async () => {
      // Sem firmographics (findFirst segue no default `null` de `buildTx`),
      // sem rating/reviewCount — nenhuma fonte de pontos, `breakdown.total`
      // fica em 0, nunca cruza `QUALIFICATION_THRESHOLD`.
      const prisma = buildPrisma(buildLead({ whatsapp: '5519999999999' }));
      setupTx();
      (ssrfSafeFetch as jest.Mock).mockResolvedValue({ ok: true, status: 200, finalUrl: 'https://exemplo.com.br/', body: '<html></html>' });

      const enqueueAutodraft = jest.fn().mockResolvedValue(undefined);
      await processWebsiteProfileJob(prisma as never, jobData, enqueueAutodraft);

      expect(enqueueAutodraft).not.toHaveBeenCalled();
    });
  });
});
