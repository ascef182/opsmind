import type { PrismaClient, Prisma, ScrapeJob, ScrapeSourceType, Lead, LeadStatus } from '@opsmind/database';
import type { LeadScrapeJobData } from '@opsmind/shared-types';
import { scoreLead, QUALIFICATION_THRESHOLD, type LeadScoringInput, type ServiceOfferingIcp } from '@opsmind/shared-types';
import type {
  ApifyGateway,
  ApifyBusinessResult,
  ExploriumGateway,
  ExploriumBusinessResult,
  CamofoxGateway,
  CamofoxSearchResult,
} from '@opsmind/integrations';
import type Redis from 'ioredis';
import * as Sentry from '@sentry/node';
import { withTenantContext } from './tenant-context';
import { isOverBudget, recordSpend } from './budget';

export interface LeadScrapeGateways {
  apify: ApifyGateway;
  explorium: ExploriumGateway;
  camofox: CamofoxGateway;
}

/**
 * Custo estimado por lead retornado, em USD, por fonte — usado SÓ para o
 * corte de orçamento (nunca para faturamento real; não é o custo exato
 * cobrado por cada provedor, é uma ordem de grandeza documentada aqui pra
 * ser fácil de corrigir depois com números reais):
 *   - Apify: ~US$0,01/resultado — o actor `compass/google-maps-extractor` é
 *     cobrado por "compute unit" da plataforma Apify, não por resultado
 *     individual; este valor é um proxy conservador.
 *   - Explorium: ~US$0,05/resultado — API B2B de firmografia, tipicamente
 *     mais cara que scraping simples (é dado enriquecido, não só raspagem).
 *     Usado tanto para a busca quanto (embutido no mesmo número) para a
 *     chamada de `matchBusiness` de enrichment feita por lead estruturado.
 *   - Camoufox (self-hosted): ~US$0,001/resultado — sem custo de API de
 *     terceiro, só o custo (pequeno, mas não nulo) de tempo de
 *     computação/proxy do navegador self-hosted.
 *   - MANUAL: 0 — nunca gera custo (nem chega a rodar, ver registry abaixo).
 */
const SCRAPING_COST_PER_LEAD_USD: Record<ScrapeSourceType, number> = {
  APIFY_GOOGLE_MAPS: 0.01,
  EXPLORIUM_BUSINESS_SEARCH: 0.05,
  CAMOFOX_GOOGLE_SEARCH: 0.001,
  CAMOFOX_REDDIT_SEARCH: 0.001,
  MANUAL: 0,
};

const STRUCTURED_WEBSITE_SOURCES: ReadonlySet<ScrapeSourceType> = new Set([
  'APIFY_GOOGLE_MAPS',
  'EXPLORIUM_BUSINESS_SEARCH',
]);

/**
 * Único `sourceType` que precisa de uma chamada de enrichment separada
 * (`explorium.matchBusiness`) para obter firmographics — Apify não devolve
 * firmografia nenhuma na própria busca. `EXPLORIUM_BUSINESS_SEARCH` NÃO
 * entra aqui: a própria busca já devolve `employeeCount`/`revenueUsd`
 * (ver `mapExploriumResult`), então uma segunda chamada de match por nome/
 * endereço seria (a) redundante e (b) arriscaria PERDER dado que a busca já
 * tinha, caso o match fuzzy não re-encontre o mesmo negócio.
 */
const NEEDS_MATCH_ENRICHMENT: ReadonlySet<ScrapeSourceType> = new Set(['APIFY_GOOGLE_MAPS']);

/**
 * Shape intermediário e estável ao qual TODO resultado bruto de gateway
 * (Apify/Explorium/Camoufox) é normalizado antes de virar `Lead` — é o que
 * permite ao passo de persistência (upsert + score) ser genérico por
 * `sourceType`, sem um `switch` por gateway.
 *
 * `website` só é preenchido para fontes estruturadas (Apify/Explorium) —
 * Camoufox nunca escreve em `website` mesmo quando a URL do resultado É de
 * fato o site do negócio, porque não há como confirmar isso a partir de um
 * resultado de busca genérico (`@google_search`/`@reddit_search`); a URL do
 * resultado Camoufox vai em `url` (usado só para dedup, nunca para
 * `Lead.website`) e o texto em `rawContent` (fallback de keyword-match do
 * `scoreLead`).
 *
 * `firmographics`/`enrichmentSource`: preenchidos JÁ NA MAPEAÇÃO quando a
 * própria busca do gateway devolve firmografia (hoje só Explorium) — usados
 * diretamente pelo scoring sem precisar de uma chamada de enrichment
 * adicional. `null` para fontes que não trazem firmografia na busca (Apify,
 * que passa por `matchBusiness` depois; Camoufox, que nunca tem).
 */
interface RawCandidate {
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  phone: string | null;
  website: string | null;
  googleCategory: string | null;
  rating: number | null;
  reviewCount: number | null;
  placeId: string | null;
  /** URL do resultado de busca (só Camoufox) — usada exclusivamente para dedup, nunca copiada para `Lead.website`. */
  url: string | null;
  rawContent: string | null;
  rawSnapshot: Record<string, unknown>;
  firmographics: LeadScoringInput['firmographics'];
  enrichmentSource: ExploriumBusinessResult | null;
}

function mapApifyResult(r: ApifyBusinessResult): RawCandidate {
  return {
    name: r.name,
    address: r.address,
    city: r.city,
    state: r.state,
    phone: r.phone,
    website: r.website,
    googleCategory: r.googleCategory,
    rating: r.rating,
    reviewCount: r.reviewCount,
    placeId: r.placeId,
    url: null,
    rawContent: null,
    rawSnapshot: r.raw,
    // Apify não devolve firmografia nenhuma — só chega via `matchBusiness`
    // no passo de enrichment (ver `NEEDS_MATCH_ENRICHMENT`).
    firmographics: null,
    enrichmentSource: null,
  };
}

function mapExploriumResult(r: ExploriumBusinessResult): RawCandidate {
  return {
    name: r.name,
    address: null,
    city: null,
    state: null,
    phone: null,
    website: r.website,
    // Explorium não devolve uma "categoria Google" — `industry` é o análogo
    // mais próximo disponível na própria resposta de busca.
    googleCategory: r.industry,
    rating: null,
    reviewCount: null,
    placeId: null,
    url: null,
    rawContent: null,
    rawSnapshot: r.raw,
    // A própria busca da Explorium já devolve firmografia — usada direto,
    // SEM uma segunda chamada de `matchBusiness` (ver `NEEDS_MATCH_ENRICHMENT`
    // acima pro racional: uma segunda chamada fuzzy poderia falhar/não
    // re-encontrar o negócio e apagar um dado que a busca já tinha).
    firmographics: { industry: r.industry, employeeCount: r.employeeCount, revenueUsd: r.revenueUsd },
    enrichmentSource: r,
  };
}

function mapCamofoxResult(r: CamofoxSearchResult): RawCandidate {
  return {
    name: r.title ?? r.url,
    address: null,
    city: null,
    state: null,
    phone: null,
    website: null,
    googleCategory: null,
    rating: null,
    reviewCount: null,
    placeId: null,
    url: r.url,
    rawContent: [r.title, r.textContent].filter((v): v is string => !!v).join('\n\n') || null,
    rawSnapshot: r.raw,
    firmographics: null,
    enrichmentSource: null,
  };
}

type SourceHandler = (job: ScrapeJob, gateways: LeadScrapeGateways) => Promise<RawCandidate[]>;

/**
 * Registry `sourceType → gateway` (nunca um `switch` crescente — mesmo
 * racional documentado em CLAUDE.md para esta feature). `MANUAL` não é uma
 * fonte de scraping de verdade (é o valor usado quando um `Lead` é criado à
 * mão via UI, fora deste pipeline) — lança para nunca silenciosamente não
 * fazer nada quando um `ScrapeJob` chega aqui com essa fonte por engano.
 */
const SOURCE_REGISTRY: Record<ScrapeSourceType, SourceHandler> = {
  APIFY_GOOGLE_MAPS: async (job, gateways) => {
    const results = await gateways.apify.searchBusinesses({
      city: job.city,
      state: job.state,
      businessType: job.businessType,
      limit: job.limit,
    });
    return results.map(mapApifyResult);
  },
  EXPLORIUM_BUSINESS_SEARCH: async (job, gateways) => {
    const results = await gateways.explorium.searchBusinesses({
      city: job.city,
      state: job.state,
      businessType: job.businessType,
      onlyWithoutWebsite: job.onlyWithoutWebsite,
      limit: job.limit,
    });
    return results.map(mapExploriumResult);
  },
  CAMOFOX_GOOGLE_SEARCH: async (job, gateways) => {
    const results = await gateways.camofox.search({
      macro: '@google_search',
      query: `${job.businessType} em ${job.city}, ${job.state}`,
      limit: job.limit,
    });
    return results.map(mapCamofoxResult);
  },
  CAMOFOX_REDDIT_SEARCH: async (job, gateways) => {
    const results = await gateways.camofox.search({
      macro: '@reddit_search',
      query: `${job.businessType} ${job.city} ${job.state}`,
      limit: job.limit,
    });
    return results.map(mapCamofoxResult);
  },
  MANUAL: async () => {
    throw new Error('MANUAL não é uma fonte de scraping automatizável');
  },
};

interface EnrichedCandidate {
  candidate: RawCandidate;
  firmographics: LeadScoringInput['firmographics'];
  enrichmentRaw: ExploriumBusinessResult | null;
}

/**
 * ── Estratégia de dedup para leads sem `placeId` (decidida e documentada
 * aqui, conforme pedido) ──────────────────────────────────────────────────
 *
 * `Lead` só tem unique constraint em `(organizationId, placeId)`, e
 * `placeId` só existe para Apify (Google Maps sempre devolve um). Leads do
 * Camoufox nunca têm `placeId`, e leads do Explorium também não (a API não
 * expõe um id estável de negócio na resposta de busca) — para esses dois
 * casos não há chave de banco pronta, então o dedup é feito em duas
 * camadas, em ordem de preferência:
 *
 *   1) URL normalizada — `candidate.url` (resultado de busca do Camoufox)
 *      ou `candidate.website` (Explorium, quando a busca devolve um site
 *      mesmo sem placeId). Normalização (`normalizeUrlForDedup` abaixo):
 *      lowercase inteiro, remove prefixo "www.", ignora protocolo
 *      (http/https tratados como equivalentes), remove querystring/fragment
 *      e uma barra final. Persistida em `rawSnapshot._dedupUrl` (não existe
 *      coluna própria para isso) e buscada via filtro de path JSON do
 *      Postgres (`{ path: ['_dedupUrl'], equals: ... }`, suportado nativamente
 *      pelo Prisma para campos `Json` sem preview flag).
 *   2) Nome + cidade + estado (case-insensitive) — último recurso, só usado
 *      quando não há absolutamente nenhuma URL (nem `website` nem `url` de
 *      busca). Mais fraco: pode colidir por engano em nomes genéricos
 *      ("Padaria Central" em duas cidades diferentes não colide porque
 *      cidade/estado entram na chave; mas duas filiais com o MESMO nome na
 *      mesma cidade colidiriam como se fossem uma só). Aceito como
 *      trade-off consciente — o objetivo é evitar duplicar a mesma linha a
 *      cada re-scan do mesmo `ScrapeJob`/cidade, não garantir unicidade
 *      perfeita para fontes sem nenhum identificador estável.
 *
 * Ambos os casos usam `findFirst` + `create`/`update` condicional (não há
 * constraint única no banco para acionar um `upsert` de verdade nesses
 * caminhos).
 */
export function normalizeUrlForDedup(rawUrl: string | null): string | null {
  if (!rawUrl || rawUrl.trim() === '') return null;
  try {
    const withProtocol = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    const parsed = new URL(withProtocol);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const path = parsed.pathname.replace(/\/$/, '');
    return `${host}${path}`.toLowerCase();
  } catch {
    // URL não parseável (lixo vindo de scraping) — normalização best-effort
    // sem lançar: lowercase + corta querystring/fragment/barra final à mão.
    return rawUrl
      .trim()
      .toLowerCase()
      .replace(/[?#].*$/, '')
      .replace(/\/$/, '');
  }
}

function toOfferingIcp(o: {
  id: string;
  signals: string[];
  targetIndustries: string[];
  minEmployees: number | null;
  maxEmployees: number | null;
  minRevenueUsd: number | null;
  maxRevenueUsd: number | null;
}): ServiceOfferingIcp {
  return {
    id: o.id,
    signals: o.signals,
    targetIndustries: o.targetIndustries,
    minEmployees: o.minEmployees,
    maxEmployees: o.maxEmployees,
    minRevenueUsd: o.minRevenueUsd,
    maxRevenueUsd: o.maxRevenueUsd,
  };
}

async function upsertLead(
  tx: Prisma.TransactionClient,
  data: LeadScrapeJobData,
  sourceType: ScrapeSourceType,
  candidate: RawCandidate,
  firmographics: LeadScoringInput['firmographics'],
  offeringsIcp: ServiceOfferingIcp[],
): Promise<Lead> {
  const scoreInput: LeadScoringInput = {
    website: candidate.website,
    googleCategory: candidate.googleCategory,
    rating: candidate.rating,
    reviewCount: candidate.reviewCount,
    rawContent: candidate.rawContent,
    firmographics,
  };
  const breakdown = scoreLead(scoreInput, offeringsIcp);
  const status: LeadStatus = breakdown.total >= QUALIFICATION_THRESHOLD ? 'QUALIFIED' : 'DISQUALIFIED';

  const baseData = {
    organizationId: data.organizationId,
    scrapeJobId: data.scrapeJobId,
    sourceType,
    name: candidate.name,
    address: candidate.address,
    city: candidate.city,
    state: candidate.state,
    phone: candidate.phone,
    website: candidate.website,
    googleCategory: candidate.googleCategory,
    rating: candidate.rating,
    reviewCount: candidate.reviewCount,
    placeId: candidate.placeId,
    rawContent: candidate.rawContent,
    status,
    score: breakdown.total,
    scoreBreakdown: breakdown as unknown as Prisma.InputJsonValue,
    suggestedOfferingId: breakdown.matchedOfferingId,
    actorType: data.actorType,
    actorId: data.actorId ?? null,
  };

  if (candidate.placeId) {
    const rawSnapshot = candidate.rawSnapshot as Prisma.InputJsonValue;
    return tx.lead.upsert({
      where: { organizationId_placeId: { organizationId: data.organizationId, placeId: candidate.placeId } },
      create: { ...baseData, rawSnapshot },
      update: { ...baseData, rawSnapshot },
    });
  }

  // Sem placeId: ver comentário da estratégia de dedup acima.
  const dedupUrl = normalizeUrlForDedup(candidate.url ?? candidate.website ?? null);
  const rawSnapshot = { ...candidate.rawSnapshot, _dedupUrl: dedupUrl } as Prisma.InputJsonValue;
  const dataWithSnapshot = { ...baseData, rawSnapshot };

  const existing = dedupUrl
    ? await tx.lead.findFirst({
        where: {
          organizationId: data.organizationId,
          sourceType,
          rawSnapshot: { path: ['_dedupUrl'], equals: dedupUrl },
        },
      })
    : await tx.lead.findFirst({
        where: {
          organizationId: data.organizationId,
          sourceType,
          name: { equals: candidate.name, mode: 'insensitive' },
          city: candidate.city,
          state: candidate.state,
        },
      });

  if (existing) {
    return tx.lead.update({ where: { id: existing.id }, data: dataWithSnapshot });
  }
  return tx.lead.create({ data: dataWithSnapshot });
}

interface FinalizeParams {
  status: 'COMPLETED' | 'FAILED';
  leadsFound: number;
  errorMessage?: string;
  /** Custo estimado a registrar no orçamento — 0 quando nada foi de fato gasto (ex.: orçamento já estourado antes de chamar qualquer gateway). */
  cost: number;
}

/**
 * Passo 4 do processor: tx curta pra marcar o `ScrapeJob` em status
 * terminal, seguida (FORA da tx) do registro de gasto no orçamento e de um
 * `AuditLog` — nenhum dos dois depende de RLS/tenant-context nem precisa
 * reverter junto com a atualização do job, então não há razão pra
 * prendê-los na mesma transação.
 *
 * IMPORTANTE: uma vez que a tx acima confirma o status terminal (e, no
 * caminho COMPLETED, os `Lead`/`LeadEnrichment` do passo 3 já foram
 * commitados antes disso), o trabalho "de verdade" do job já aconteceu e já
 * está correto no banco. `recordSpend`/`AuditLog` são bookkeeping
 * SECUNDÁRIO — uma falha neles NUNCA pode se propagar pro `catch` externo
 * de `processLeadScrapeJob`, que reescreveria o job pra `FAILED` mesmo com
 * os leads já salvos (um status terminal mentiroso, que enganaria qualquer
 * lógica futura de "retentar jobs FAILED" a duplicar leads). Por isso esse
 * trecho tem seu próprio try/catch: reporta pro Sentry (e stderr, caso o
 * Sentry esteja desabilitado por falta de `SENTRY_DSN`) e segue — nunca
 * relança.
 */
async function finalizeJob(
  prisma: PrismaClient,
  redis: Redis,
  data: LeadScrapeJobData,
  params: FinalizeParams,
): Promise<ScrapeJob> {
  const updated = await withTenantContext(prisma, data.organizationId, (tx) =>
    tx.scrapeJob.update({
      where: { id: data.scrapeJobId },
      data: {
        status: params.status,
        leadsFound: params.leadsFound,
        finishedAt: new Date(),
        errorMessage: params.errorMessage ?? null,
      },
    }),
  );

  try {
    if (params.cost > 0) {
      await recordSpend(redis, data.organizationId, params.cost);
    }
    await prisma.auditLog.create({
      data: {
        organizationId: data.organizationId,
        actorType: data.actorType,
        actorId: data.actorId ?? null,
        action: 'lead_scrape.finished',
        resource: `ScrapeJob:${data.scrapeJobId}`,
        metadata: { status: params.status, leadsFound: params.leadsFound, cost: params.cost },
      },
    });
  } catch (bookkeepingError) {
    Sentry.captureException(bookkeepingError, {
      extra: {
        scrapeJobId: data.scrapeJobId,
        organizationId: data.organizationId,
        phase: 'lead-scrape-finalize-bookkeeping',
      },
    });
    // eslint-disable-next-line no-console -- visibilidade mínima mesmo sem SENTRY_DSN configurado (SDK vira no-op nesse caso)
    console.error(
      `[lead-scrape-processor] falha ao registrar gasto/audit log do ScrapeJob ${data.scrapeJobId} (status "${params.status}" já commitado corretamente, NÃO revertido):`,
      bookkeepingError,
    );
  }

  return updated;
}

/**
 * Processa um job de scraping de leads, consumido da fila `lead-scrape`.
 *
 * Divergência deliberada do padrão de UMA transação grande de
 * `automation-processor.ts`: automations são rápidas (só leituras/escritas
 * no próprio Postgres); isto envolve uma chamada de rede potencialmente
 * longa (segundos a minutos) a um gateway externo (Apify/Explorium/
 * Camoufox). Seguar uma transação/conexão Postgres aberta por esse tempo
 * arriscaria esgotar o pool de conexões sob carga — em vez disso, 3
 * transações CURTAS ao redor de 1 fase SEM transação nenhuma:
 *
 *   1. tx curta — marca o job RUNNING.
 *   2. SEM transação — recarrega o job, checa orçamento, chama o gateway
 *      externo e tenta enriquecer cada lead estruturado (best-effort,
 *      try/catch por lead).
 *   3. tx curta — persiste os leads (upsert + score + enrichment).
 *   4. tx curta — marca o job em status terminal; fora dela, registra gasto
 *      no orçamento e grava AuditLog.
 *
 * Qualquer erro não capturado no meio (rede, transação revertida, bug):
 * o `catch` externo marca FAILED via `prisma` direto (nunca dentro de uma
 * tx já revertida) — o job SEMPRE termina em status terminal, nunca fica
 * "pendurado" em QUEUED/RUNNING.
 */
export async function processLeadScrapeJob(
  prisma: PrismaClient,
  gateways: LeadScrapeGateways,
  redis: Redis,
  data: LeadScrapeJobData,
): Promise<ScrapeJob> {
  try {
    // Passo 1 — tx curta: marca RUNNING.
    await withTenantContext(prisma, data.organizationId, (tx) =>
      tx.scrapeJob.update({
        where: { id: data.scrapeJobId },
        data: { status: 'RUNNING', startedAt: new Date() },
      }),
    );

    // Passo 2 — FORA de qualquer transação: ver comentário da função acima.
    // Lê via `prisma` direto (sem tx/tenant-context) — RLS permite (fallback
    // "sem contexto = allow", ver migration `20260902120100_leads_prospecting_rls`),
    // e o filtro explícito de `organizationId` abaixo garante o isolamento de
    // qualquer forma (defesa em profundidade, igual ao resto do sistema).
    const scrapeJob = await prisma.scrapeJob.findFirstOrThrow({
      where: { id: data.scrapeJobId, organizationId: data.organizationId },
    });

    const organization = await prisma.organization.findUniqueOrThrow({
      where: { id: data.organizationId },
    });
    const monthlyBudget =
      organization.scrapingMonthlyBudget !== null ? Number(organization.scrapingMonthlyBudget) : null;

    if (await isOverBudget(redis, data.organizationId, monthlyBudget)) {
      return finalizeJob(prisma, redis, data, {
        status: 'FAILED',
        leadsFound: 0,
        errorMessage: `Orçamento mensal de scraping (US$ ${monthlyBudget}) já atingido para esta organização — job não executado, nada foi gasto.`,
        cost: 0,
      });
    }

    const handler = SOURCE_REGISTRY[scrapeJob.sourceType];
    const rawCandidates = await handler(scrapeJob, gateways);

    // `onlyWithoutWebsite` só faz sentido pra fontes com campo `website`
    // estruturado (Apify/Explorium) — resultados do Camoufox não têm esse
    // campo (ver `RawCandidate`), então o filtro nunca se aplica a eles.
    const isStructuredWebsiteSource = STRUCTURED_WEBSITE_SOURCES.has(scrapeJob.sourceType);
    const candidates =
      scrapeJob.onlyWithoutWebsite && isStructuredWebsiteSource
        ? rawCandidates.filter((c) => !c.website)
        : rawCandidates;

    const enriched: EnrichedCandidate[] = [];
    for (const candidate of candidates) {
      // Ponto de partida: firmografia que a própria busca do gateway já
      // trouxe (hoje só Explorium — ver `mapExploriumResult`). `null` pra
      // Apify/Camoufox, que não trazem nada na busca.
      let firmographics: LeadScoringInput['firmographics'] = candidate.firmographics;
      let enrichmentRaw: ExploriumBusinessResult | null = candidate.enrichmentSource;
      // Só Apify precisa de uma chamada de enrichment SEPARADA
      // (`matchBusiness`) — Explorium já tem firmografia da própria busca
      // (não repete a chamada: ver `NEEDS_MATCH_ENRICHMENT`); Camoufox cai
      // direto pro fallback de keyword-match do `scoreLead` (não há
      // `name`/`address` confiáveis o bastante pra tentar um match de
      // negócio).
      if (NEEDS_MATCH_ENRICHMENT.has(scrapeJob.sourceType)) {
        try {
          const match = await gateways.explorium.matchBusiness(
            candidate.name,
            candidate.address,
            candidate.website,
          );
          if (match) {
            firmographics = {
              industry: match.industry,
              employeeCount: match.employeeCount,
              revenueUsd: match.revenueUsd,
            };
            enrichmentRaw = match;
          }
        } catch {
          // Enrichment é best-effort POR LEAD — uma falha aqui (rede, rate
          // limit, negócio não encontrado na base da Explorium) nunca
          // derruba o job inteiro; só este lead fica sem firmographics.
        }
      }
      enriched.push({ candidate, firmographics, enrichmentRaw });
    }

    // Passo 3 — tx curta: persiste os leads (upsert + score + enrichment).
    const leadsFound = await withTenantContext(prisma, data.organizationId, async (tx) => {
      const offerings = await tx.serviceOffering.findMany({
        where: { organizationId: data.organizationId, isActive: true },
      });
      const offeringsIcp = offerings.map(toOfferingIcp);

      let count = 0;
      for (const { candidate, firmographics, enrichmentRaw } of enriched) {
        const lead = await upsertLead(tx, data, scrapeJob.sourceType, candidate, firmographics, offeringsIcp);
        if (enrichmentRaw) {
          await tx.leadEnrichment.create({
            data: {
              organizationId: data.organizationId,
              leadId: lead.id,
              type: 'explorium_firmographics',
              data: enrichmentRaw as unknown as Prisma.InputJsonValue,
              actorType: data.actorType,
              actorId: data.actorId ?? null,
            },
          });
        }
        count += 1;
      }
      return count;
    });

    const cost = leadsFound * SCRAPING_COST_PER_LEAD_USD[scrapeJob.sourceType];
    return await finalizeJob(prisma, redis, data, { status: 'COMPLETED', leadsFound, cost });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    return prisma.scrapeJob.update({
      where: { id: data.scrapeJobId },
      data: { status: 'FAILED', errorMessage, finishedAt: new Date() },
    });
  }
}
