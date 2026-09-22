import type { PrismaClient, Prisma, ScrapeJob, ScrapeSourceType, Lead, LeadStatus } from '@opsmind/database';
import type { LeadScrapeJobData, OutreachAutodraftJobData, OutreachChannel } from '@opsmind/shared-types';
import {
  scoreLead,
  isSafeHttpUrl,
  QUALIFICATION_THRESHOLD,
  ROLE_HIERARCHY,
  pickRoundRobinAssignee,
  STRUCTURED_WEBSITE_SOURCES,
  type LeadScoringInput,
  type ServiceOfferingIcp,
  type SocialLink,
  type SocialPlatform,
} from '@opsmind/shared-types';
import type {
  ApifyGateway,
  ApifyBusinessResult,
  ExploriumGateway,
  ExploriumBusinessResult,
  CamofoxGateway,
  CamofoxSearchResult,
  ContactEnrichmentGateway,
  InstagramProfileResult,
} from '@opsmind/integrations';
import type Redis from 'ioredis';
import * as Sentry from '@sentry/node';
import { withTenantContext } from './tenant-context';
import { isOverBudget, recordSpend } from './budget';

// Duplicada de apps/api/src/shared/constants/roles.constant.ts de propósito
// (worker não pode importar de apps/api) — mesma regra: todo papel exceto
// VIEWER pode ser dono de um lead. Derivada de `ROLE_HIERARCHY`
// (@opsmind/shared-types), não hardcoded, pra nunca divergir da ordem
// canônica de papéis.
const WRITE_ROLES = ROLE_HIERARCHY.filter((role) => role !== 'VIEWER');

export interface LeadScrapeGateways {
  apify: ApifyGateway;
  explorium: ExploriumGateway;
  camofox: CamofoxGateway;
  contactEnrichment: ContactEnrichmentGateway;
}

/**
 * Custo estimado por lead retornado, em USD, por fonte — usado SÓ para o
 * corte de orçamento (nunca para faturamento real; não é o custo exato
 * cobrado por cada provedor, é uma ordem de grandeza documentada aqui pra
 * ser fácil de corrigir depois com números reais):
 *   - Apify (plano Free): US$0,006/lead — scrape base (US$0,004/lead) + place
 *     details (US$0,002/lead), os DOIS passos que o pipeline automático usa
 *     por lead, então a constante soma os dois (a Task 1 enumerou as duas
 *     parcelas mas gravou só a primeira — corrigido aqui; subestimar custo
 *     faz a organização gastar acima do teto que configurou).
 *     CRÍTICO: Os add-ons de enrichment da Apify (company contacts, social
 *     profiles, emails) custam ~US$0,10/lead (17x mais) e NUNCA devem ser
 *     usados pelo pipeline automático — causariam esgotamento de orçamento
 *     incontrolável. Use apenas scrape base + place details.
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
  APIFY_GOOGLE_MAPS: 0.006,
  EXPLORIUM_BUSINESS_SEARCH: 0.05,
  CAMOFOX_GOOGLE_SEARCH: 0.001,
  CAMOFOX_REDDIT_SEARCH: 0.001,
  MANUAL: 0,
};

/**
 * Custo estimado POR CHAMADA (não por lead, ao contrário de
 * `SCRAPING_COST_PER_LEAD_USD` acima) do passo de descoberta de contato/
 * redes (Task 9, ver `discoverContactAndSocials`) — um lead pode gerar 0, 1
 * ou 2 chamadas de actor dependendo de quantos passos do caminho primário
 * rodam de fato (`scrapeContactInfo` sempre; `lookupInstagramProfile` só
 * quando um handle de Instagram é encontrado). Vive numa constante separada
 * de `SCRAPING_COST_PER_LEAD_USD` porque aquela é indexada por
 * `ScrapeSourceType` (a fonte do `ScrapeJob` inteiro) — estes dois IDs de
 * actor não são fontes de `ScrapeJob`, são um passo de enrichment por lead
 * dentro de qualquer fonte estruturada.
 *
 * VALORES CONSERVADORES E NÃO CONFIRMADOS — mesma disciplina de honestidade
 * do comentário de `SCRAPING_COST_PER_LEAD_USD`: mesma ordem de grandeza da
 * Explorium, nunca tratados como grátis só porque a Apify já está
 * configurada pro Google Maps. Corrigir aqui assim que houver números reais.
 * O custo do caminho de fallback (Camoufox) reaproveita
 * `SCRAPING_COST_PER_LEAD_USD.CAMOFOX_GOOGLE_SEARCH` — é literalmente a
 * mesma chamada (`camofox.search` com `macro: '@google_search'`).
 */
const CONTACT_ENRICHMENT_COST_PER_CALL_USD = {
  APIFY_CONTACT_ENRICHMENT: 0.05,
  APIFY_INSTAGRAM_PROFILE: 0.05,
} as const;

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
  // `true` só quando a fonte confirma ausência de site (Apify/Explorium com
  // `website: null` na própria busca) — nunca `true` pro Camoufox, que
  // simplesmente não captura este campo. Ver `LeadScoringInput
  // .websiteConfirmedAbsent` (`@opsmind/shared-types`, `lead-scoring.ts`)
  // pro porquê disso importa: sem essa distinção, `scoreLead` dava os 50
  // pontos de "sem site" pra TODO lead do Camoufox, sempre.
  websiteConfirmedAbsent: boolean;
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
  /**
   * Campos de contato/redes (Task 9) — SEMPRE `null` na mapeação inicial do
   * resultado bruto do gateway de busca (nenhuma das três fontes de busca
   * devolve isto na própria busca); só passam a ter valor quando
   * `discoverContactAndSocials` os encontra e MUTA o candidato diretamente
   * (ver essa função, mais abaixo). A condição "sem whatsapp/socialLinks
   * ainda preenchidos" do passo do worker é checada contra estes mesmos
   * campos.
   */
  whatsapp: string | null;
  email: string | null;
  socialLinks: SocialLink[] | null;
}

function mapApifyResult(r: ApifyBusinessResult): RawCandidate {
  return {
    name: r.name,
    address: r.address,
    city: r.city,
    state: r.state,
    phone: r.phone,
    website: r.website,
    // Google Maps (via Apify) expõe um campo de site de verdade na própria
    // busca — `null` aqui é uma ausência confirmada, não um gap de captura.
    websiteConfirmedAbsent: r.website === null,
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
    whatsapp: null,
    email: null,
    socialLinks: null,
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
    // Mesmo racional da Apify acima — a busca da Explorium expõe um campo
    // de site real, então `null` aqui é confirmado, não desconhecido.
    websiteConfirmedAbsent: r.website === null,
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
    whatsapp: null,
    email: null,
    socialLinks: null,
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
    // NUNCA `true` pro Camoufox: um resultado de busca genérico
    // (`@google_search`/`@reddit_search`) não confirma ausência de site,
    // só que este campo não foi observado (ver comentário de `website` na
    // definição de `RawCandidate` acima). Achado real que motivou este
    // campo: antes disso, todo lead do Camoufox ganhava os 50 pontos de
    // "sem site" (= QUALIFICATION_THRESHOLD) só por vir desta fonte.
    websiteConfirmedAbsent: false,
    googleCategory: null,
    rating: null,
    reviewCount: null,
    placeId: null,
    url: r.url,
    rawContent: [r.title, r.textContent].filter((v): v is string => !!v).join('\n\n') || null,
    rawSnapshot: r.raw,
    firmographics: null,
    enrichmentSource: null,
    whatsapp: null,
    email: null,
    socialLinks: null,
  };
}

// Domínios de portal/agregador BR conhecidos que aparecem com frequência nos
// resultados de `@google_search` pra categorias de negócio genéricas
// (imobiliária, barbearia etc.) — sempre a PRÓPRIA página do portal, nunca
// um negócio individual. Heurística curta e deliberadamente NÃO exaustiva
// (achado real: 2026-09, resultados como "766 imobiliárias em São Paulo... -
// Imovelweb" virando lead QUALIFIED) — vai precisar de manutenção conforme
// novos portais aparecerem nos resultados reais. Combinada com
// `LISTICLE_TITLE_PATTERN` abaixo, não substitui o fix de scoring da Fase 1
// (`websiteConfirmedAbsent`), só reduz o volume de lixo que chega a virar
// `Lead` em primeiro lugar.
const KNOWN_DIRECTORY_DOMAINS: ReadonlySet<string> = new Set([
  'imovelweb.com.br',
  'vivareal.com.br',
  'zapimoveis.com.br',
  'olx.com.br',
  'lopes.com.br',
  'lello.com.br',
  'guiamais.com.br',
  'apontador.com.br',
  'telelistas.net',
  'reclameaqui.com.br',
]);

// "As 20 melhores barbearias em São Paulo", "766 imobiliárias em São Paulo",
// "8 barbearias incríveis em SP que todo homem deveria conhecer" — título de
// listicle/blog sobre a categoria, não o negócio em si. Best-effort: nem
// todo diretório usa essas palavras, e um negócio real cujo nome contenha
// um número ("Barbearia Top 10") pode colidir — ver comentário de
// `looksLikeDirectoryOrListicle`.
const LISTICLE_TITLE_PATTERN = /\bmelhores?\b|\btop\s*\d+\b|\b\d+\s+\S+.*\bem\b/i;

function extractHostname(rawUrl: string): string | null {
  try {
    const withProtocol = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    return new URL(withProtocol).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * Filtro best-effort aplicado só a `@google_search` (Camoufox) ANTES de virar
 * `RawCandidate`/`Lead` — descarta o que claramente é uma página de
 * diretório/portal/listicle sobre a categoria buscada, não um negócio local
 * individual. NÃO é uma garantia de correção: falso-negativo é certo (qualquer
 * domínio fora da denylist, ou título de listicle fraseado diferente, passa
 * batido) e falso-positivo é possível (negócio real com número no nome, ex.
 * "Restaurante 5 Estrelas"). Complementa, não substitui, o fix de scoring da
 * Fase 1 — a defesa real contra qualificar lixo é `websiteConfirmedAbsent`;
 * isto só reduz volume.
 */
export function looksLikeDirectoryOrListicle(candidate: { title: string | null; url: string }): boolean {
  const host = extractHostname(candidate.url);
  if (host && KNOWN_DIRECTORY_DOMAINS.has(host)) {
    return true;
  }
  if (candidate.title && LISTICLE_TITLE_PATTERN.test(candidate.title)) {
    return true;
  }
  return false;
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
    // Filtro de portal/listicle só faz sentido aqui — `@reddit_search`
    // (abaixo) é estruturalmente diferente (thread individual, não página de
    // diretório) e `runCamofoxFallback` busca perfil social, não candidato a
    // lead (ver docstring de `looksLikeDirectoryOrListicle`).
    const filtered = results.filter((r) => !looksLikeDirectoryOrListicle(r));
    const discarded = results.length - filtered.length;
    if (discarded > 0) {
      // eslint-disable-next-line no-console -- visibilidade mínima da heurística de filtro (sem logger estruturado disponível nesta função pura)
      console.info(
        `[lead-scrape-processor] ${discarded}/${results.length} resultado(s) do Camoufox descartado(s) por parecer diretório/portal/listicle (scrapeJobId=${job.id}).`,
      );
    }
    return filtered.map(mapCamofoxResult);
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

/** Registro pronto pra virar `LeadEnrichment{type:'contact_enrichment'}` — ver `discoverContactAndSocials`. */
interface ContactEnrichmentResult {
  source: 'apify_actor' | 'camoufox_fallback';
  data: Record<string, unknown>;
}

interface EnrichedCandidate {
  candidate: RawCandidate;
  firmographics: LeadScoringInput['firmographics'];
  enrichmentRaw: ExploriumBusinessResult | null;
  contactEnrichment: ContactEnrichmentResult | null;
}

/**
 * Domínios conhecidos → `SocialPlatform`, usados pelo caminho de fallback
 * Camoufox (`runCamofoxFallback`) pra classificar cada URL de resultado de
 * busca — mesma lista de domínios do brief da Task 9. `wa.me`/
 * `api.whatsapp.com` mapeiam pra `WHATSAPP` (não é bem uma "rede social",
 * mas é o mesmo mecanismo de classificação por domínio, e é desse link que
 * sai o número que popula `Lead.whatsapp` — ver `extractWhatsappPhone`).
 */
const KNOWN_SOCIAL_DOMAINS: ReadonlyArray<{ pattern: RegExp; platform: SocialPlatform }> = [
  { pattern: /instagram\.com/i, platform: 'INSTAGRAM' },
  { pattern: /facebook\.com/i, platform: 'FACEBOOK' },
  { pattern: /linkedin\.com/i, platform: 'LINKEDIN' },
  { pattern: /(?:wa\.me|api\.whatsapp\.com)/i, platform: 'WHATSAPP' },
  { pattern: /tiktok\.com/i, platform: 'TIKTOK' },
  { pattern: /(?:twitter\.com|x\.com)/i, platform: 'TWITTER' },
  { pattern: /youtube\.com/i, platform: 'YOUTUBE' },
];

/**
 * `null` para qualquer URL que não seja http/https — o `isSafeHttpUrl` aqui
 * NÃO é redundante com o `KNOWN_SOCIAL_DOMAINS` abaixo: os padrões são
 * substring não-ancorada, então `javascript:alert(1)//instagram.com` casaria
 * como INSTAGRAM e a URL seria persistida em `Lead.socialLinks`, virando
 * `href` no frontend (XSS armazenado). O corte de esquema vem primeiro,
 * sempre.
 */
function classifySocialUrl(url: string): SocialPlatform | null {
  if (!isSafeHttpUrl(url)) {
    return null;
  }
  for (const { pattern, platform } of KNOWN_SOCIAL_DOMAINS) {
    if (pattern.test(url)) {
      return platform;
    }
  }
  return null;
}

/** Mínimo de dígitos pra um valor extraído ser aceito como telefone (evita gravar `wa.me/message/AB12` como "12"). */
const MIN_WHATSAPP_PHONE_DIGITS = 8;

/**
 * Extrai SÓ os dígitos do telefone de um link de WhatsApp (`wa.me/<digits>`
 * ou `api.whatsapp.com/send?phone=<digits>&text=...`), ou `null` quando o
 * link não é reconhecível como um desses formatos.
 *
 * Existe porque `Lead.whatsapp` é documentado (schema.prisma) e consumido
 * (`OutreachService`, que injeta "Contato WhatsApp: <valor>" no prompt; a
 * coluna "WhatsApp" da tabela de leads; `@MaxLength(40)` do
 * `CreateLeadDto`) como NÚMERO, não como URL — o link completo continua
 * sendo guardado, mas em `socialLinks` como entrada de plataforma WHATSAPP.
 * Função pura e exportada só para ser testável direto.
 */
export function extractWhatsappPhone(rawUrl: string | null): string | null {
  if (!rawUrl) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');

  let candidate: string | null = null;
  if (host === 'wa.me') {
    const segments = parsed.pathname.split('/').filter(Boolean);
    const lastSegment = segments[segments.length - 1] ?? null;
    // `pathname` vem percent-encoded (`+55 19...` → `+55%2019...`) — sem
    // decodificar, o "20" do `%20` entraria no número. `searchParams.get`
    // (ramo abaixo) já decodifica sozinho.
    try {
      candidate = lastSegment !== null ? decodeURIComponent(lastSegment) : null;
    } catch {
      candidate = lastSegment;
    }
  } else if (host === 'api.whatsapp.com' || host === 'web.whatsapp.com') {
    candidate = parsed.searchParams.get('phone');
  }

  const digits = (candidate ?? '').replace(/\D/g, '');
  return digits.length >= MIN_WHATSAPP_PHONE_DIGITS ? digits : null;
}

// "dedup por platform, cap em 6 entradas" — brief da Task 9.
const CONTACT_FALLBACK_MAX_SOCIAL_LINKS = 6;

/** Extrai o handle cru de uma URL de perfil do Instagram (`.../fulano` → `fulano`), ou `null` se não reconhecível. */
function extractInstagramHandle(url: string): string | null {
  const match = url.match(/instagram\.com\/([^/?#]+)/i);
  return match?.[1] ?? null;
}

/**
 * Caminho PRIMÁRIO da descoberta de contato/redes (Task 9) — só roda quando
 * `candidate.website` existe (não faz sentido raspar "contato" de uma
 * página que não existe). Chama `scrapeContactInfo` contra o site; se um dos
 * `socials` devolvidos for um link `WHATSAPP` (telefone reconhecível como
 * WhatsApp Business, ver aviso em `ContactEnrichmentGateway`), populariza
 * `whatsapp`; o primeiro e-mail devolvido populariza `email`. Se algum
 * social for `INSTAGRAM`, chama `lookupInstagramProfile` — se ele devolver
 * `whatsappLink`, esse valor tem PRIORIDADE sobre o telefone (link explícito
 * de clique-para-conversar no próprio perfil é mais confiável que um número
 * encontrado em texto de página).
 *
 * MUTA `candidate` diretamente (whatsapp/email/socialLinks) quando encontra
 * algo. Devolve `null` (nunca lança) quando não há website, quando nada de
 * novo foi encontrado, ou quando a chamada em si falha — nesses casos o
 * chamador (`discoverContactAndSocials`) cai pro fallback Camoufox.
 */
async function runPrimaryContactDiscovery(
  candidate: RawCandidate,
  gateway: ContactEnrichmentGateway,
): Promise<{ costUsd: number; data: Record<string, unknown> } | null> {
  if (!candidate.website) {
    return null;
  }

  const scraped = await gateway.scrapeContactInfo(candidate.website);
  let costUsd: number = CONTACT_ENRICHMENT_COST_PER_CALL_USD.APIFY_CONTACT_ENRICHMENT;

  // `scraped.phones` (números encontrados na página que NÃO foram
  // reconhecidos como link de WhatsApp — só os que viram um `SocialLink`
  // WHATSAPP em `scraped.socials`, checado logo abaixo, contam pra
  // `whatsapp`) é descartado aqui de propósito: `Lead` não tem um campo
  // "telefone achado via enrichment" distinto do `phone` já capturado no
  // momento da busca (`RawCandidate.phone`) — não fabricamos um novo.
  // Filtro de esquema ANTES de qualquer uso: `scraped.socials` vem de um
  // actor raspando o site do próprio negócio — conteúdo 100% controlado por
  // quem publica aquela página — e essas URLs acabam num `href` do frontend.
  // Qualquer coisa que não seja http/https (javascript:, data:, ...) é
  // descartada aqui, na ingestão, e não só no render.
  const safeSocials = scraped.socials.filter((s) => isSafeHttpUrl(s.url));

  let whatsappLink = safeSocials.find((s) => s.platform === 'WHATSAPP')?.url ?? null;
  const email = scraped.emails[0] ?? null;
  const instagramUrl = safeSocials.find((s) => s.platform === 'INSTAGRAM')?.url ?? null;
  const instagramHandle = instagramUrl ? extractInstagramHandle(instagramUrl) : null;

  let instagramProfile: InstagramProfileResult | null = null;
  if (instagramHandle) {
    try {
      instagramProfile = await gateway.lookupInstagramProfile(instagramHandle);
      costUsd += CONTACT_ENRICHMENT_COST_PER_CALL_USD.APIFY_INSTAGRAM_PROFILE;
    } catch {
      // Lookup de Instagram é best-effort DENTRO do próprio caminho
      // primário — uma falha aqui não derruba o resto do que já foi achado
      // via `scrapeContactInfo` (telefone/e-mail/socials continuam válidos).
      instagramProfile = null;
    }
  }
  if (instagramProfile?.whatsappLink && isSafeHttpUrl(instagramProfile.whatsappLink)) {
    whatsappLink = instagramProfile.whatsappLink;
  }
  const resolvedEmail = email ?? instagramProfile?.email ?? null;

  // `Lead.whatsapp` é um NÚMERO (ver `extractWhatsappPhone`); o link completo
  // continua preservado, mas em `socialLinks` como entrada WHATSAPP — os dois
  // sempre, nunca um ou outro. O link achado no perfil do Instagram
  // (`whatsappLink`) pode não estar em `scraped.socials`, daí o push abaixo.
  const whatsappPhone = extractWhatsappPhone(whatsappLink);
  const socialLinks: SocialLink[] = [...safeSocials];
  if (whatsappLink && !socialLinks.some((s) => s.url === whatsappLink)) {
    socialLinks.push({ platform: 'WHATSAPP', url: whatsappLink });
  }

  if (!whatsappPhone && !resolvedEmail && socialLinks.length === 0) {
    return null; // nada de novo — cai pro fallback
  }

  if (whatsappPhone) {
    candidate.whatsapp = whatsappPhone;
  }
  if (resolvedEmail) {
    candidate.email = resolvedEmail;
  }
  if (socialLinks.length > 0) {
    candidate.socialLinks = socialLinks;
  }

  return {
    costUsd,
    data: { emails: scraped.emails, phones: scraped.phones, socials: socialLinks, instagramProfile },
  };
}

/**
 * Caminho de FALLBACK da descoberta de contato/redes (Task 9) — roda quando
 * não há `candidate.website`, ou quando o caminho primário está
 * indisponível/sem resultado/lançou erro (ver `discoverContactAndSocials`).
 * Mesma lógica já desenhada no brief: busca
 * `"{name}" {city} instagram OR facebook OR linkedin OR tiktok` via
 * `camofox.search`, classifica cada URL por domínio conhecido
 * (`classifySocialUrl`, que já descarta o que não for http/https), dedup por
 * platform, cap em `CONTACT_FALLBACK_MAX_SOCIAL_LINKS`. Um link `wa.me`/
 * `api.whatsapp.com` encontrado aqui popula as DUAS pontas: o link completo
 * em `socialLinks` e só os dígitos do telefone em `whatsapp`
 * (`extractWhatsappPhone`).
 *
 * MUTA `candidate` diretamente quando encontra algo. Devolve `null` (nunca
 * lança pro chamador tratar — mas também não precisa, o chamador já embrulha
 * isto num try/catch) quando nada foi encontrado.
 */
async function runCamofoxFallback(
  candidate: RawCandidate,
  camofox: CamofoxGateway,
): Promise<Record<string, unknown> | null> {
  const query = `"${candidate.name}" ${candidate.city ?? ''} instagram OR facebook OR linkedin OR tiktok`.trim();
  const results = await camofox.search({ macro: '@google_search', query, limit: 5 });

  const socialLinks: SocialLink[] = [];
  const seenPlatforms = new Set<SocialPlatform>();
  let whatsapp: string | null = null;

  for (const result of results) {
    const platform = classifySocialUrl(result.url);
    if (!platform || seenPlatforms.has(platform)) {
      continue;
    }
    seenPlatforms.add(platform);
    socialLinks.push({ platform, url: result.url });
    if (platform === 'WHATSAPP') {
      // Só o número em `whatsapp` (ver `extractWhatsappPhone`); o link
      // completo já foi guardado em `socialLinks` na linha acima.
      whatsapp = extractWhatsappPhone(result.url);
    }
    if (socialLinks.length >= CONTACT_FALLBACK_MAX_SOCIAL_LINKS) {
      break;
    }
  }

  if (!whatsapp && socialLinks.length === 0) {
    return null;
  }

  if (whatsapp) {
    candidate.whatsapp = whatsapp;
  }
  if (socialLinks.length > 0) {
    candidate.socialLinks = socialLinks;
  }

  return { query, socialLinks, whatsapp };
}

/**
 * Passo de descoberta de contato/redes (Task 9) — orquestra os dois
 * caminhos acima. Chamada uma vez por candidato elegível (fonte estruturada,
 * ainda sem `whatsapp`/`socialLinks`) dentro do próprio try/catch por lead
 * do chamador (mesma disciplina do enrichment de firmografia, ver loop
 * principal) — mas TAMBÉM nunca lança por si só, todo caminho aqui dentro já
 * tem seu próprio try/catch, exatamente pra permitir a transição
 * primário→fallback em vez de abortar no primeiro erro.
 *
 * Orçamento (`isOverBudget`) é checado ANTES de qualquer chamada que gaste —
 * regra dura da Task 9 — e de novo aqui (além do corte de orçamento a nível
 * de job, já feito antes do job sequer começar a rodar) porque um job pode
 * processar dezenas/centenas de leads em sequência: o orçamento pode virar
 * "estourado" NO MEIO do job, por causa do próprio gasto acumulado desta
 * mesma etapa nos leads anteriores (`recordSpend` abaixo). Estourado, pula
 * silenciosamente — nice-to-have, não o propósito principal do job.
 */
async function discoverContactAndSocials(
  candidate: RawCandidate,
  contactEnrichment: ContactEnrichmentGateway,
  camofox: CamofoxGateway,
  redis: Redis,
  organizationId: string,
  monthlyBudget: number | null,
): Promise<ContactEnrichmentResult | null> {
  if (await isOverBudget(redis, organizationId, monthlyBudget)) {
    return null;
  }

  let primaryResult: { costUsd: number; data: Record<string, unknown> } | null = null;
  try {
    primaryResult = await runPrimaryContactDiscovery(candidate, contactEnrichment);
  } catch {
    primaryResult = null; // erro no caminho primário — cai pro fallback abaixo
  }

  if (primaryResult) {
    await recordSpend(redis, organizationId, primaryResult.costUsd);
    return { source: 'apify_actor', data: primaryResult.data };
  }

  // Fallback: sem website, OU caminho primário indisponível/sem resultado/erro.
  try {
    const fallbackData = await runCamofoxFallback(candidate, camofox);
    if (fallbackData) {
      await recordSpend(redis, organizationId, SCRAPING_COST_PER_LEAD_USD.CAMOFOX_GOOGLE_SEARCH);
      return { source: 'camoufox_fallback', data: fallbackData };
    }
  } catch {
    // Fallback também é best-effort — se falhar, o lead segue sem contato
    // novo (ver brief: "os dois falham/vazios → lead segue sem contato
    // novo, job principal não falha").
  }
  return null;
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

/**
 * Chave de dedup de um candidato — MESMA prioridade de `upsertLead` abaixo
 * (placeId → URL normalizada → nome+cidade+estado), usada tanto pra indexar
 * o resultado do pré-fetch (`prefetchExistingContactState`) quanto pra
 * consultar esse índice por candidato. Extraída aqui em vez de duplicada
 * pra garantir que as duas pontas SEMPRE concordem sobre qual `Lead`
 * existente corresponde a qual candidato — uma key computada com lógica
 * divergente faria o pré-fetch nunca bater com nada (silenciosamente
 * reintroduzindo o mesmo problema de custo que ele existe pra evitar).
 */
function candidateDedupKey(candidate: {
  placeId: string | null;
  url: string | null;
  website: string | null;
  name: string;
  city: string | null;
  state: string | null;
}): string {
  if (candidate.placeId) {
    return `placeId:${candidate.placeId}`;
  }
  const dedupUrl = normalizeUrlForDedup(candidate.url ?? candidate.website ?? null);
  if (dedupUrl) {
    return `url:${dedupUrl}`;
  }
  return `name:${candidate.name.toLowerCase()}|${candidate.city ?? ''}|${candidate.state ?? ''}`;
}

function hasPopulatedSocialLinks(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

/** Estado de contato/redes de um `Lead` JÁ EXISTENTE (achado por `prefetchExistingContactState`). */
interface ExistingContactState {
  whatsapp: string | null;
  socialLinks: unknown;
}

/**
 * Pré-fetch BATCHED (uma única query, nunca N consultas dentro do loop da
 * Fase 2) do estado de `whatsapp`/`socialLinks` de qualquer `Lead` JÁ
 * EXISTENTE que corresponda a algum dos `candidates` desta passada —
 * corrige um vazamento de orçamento real: sem isto, `discoverContactAndSocials`
 * (ver mais abaixo) só teria como checar campos do `RawCandidate` recém-
 * mapeado, que NUNCA vêm preenchidos por nenhuma das 3 fontes de busca — ou
 * seja, a descoberta de contato re-rodaria (e re-gastaria orçamento) em TODO
 * re-scan do mesmo negócio, mesmo quando o `Lead` já tem `whatsapp`/
 * `socialLinks` de uma execução anterior. Isso é agravado pelo re-scan
 * automático por cooldown da Task 7 (`ProspectingTarget`), que garante que
 * exatamente esse cenário acontece de verdade em produção, não só em teoria.
 *
 * Lido via `prisma` direto (sem tx), mesmo padrão já usado no resto da Fase
 * 2 (`scrapeJob.findFirstOrThrow`, `organization.findUniqueOrThrow`) — RLS
 * permite (fallback "sem contexto = allow") e o filtro explícito de
 * `organizationId` abaixo garante o isolamento de qualquer forma.
 *
 * Índice devolvido: `Map<candidateDedupKey, ExistingContactState>` — uma
 * única query com `OR` de todas as três estratégias de match possíveis
 * (placeId / URL normalizada via `_dedupUrl` / nome+cidade+estado), MESMA
 * prioridade usada por `candidateDedupKey`/`upsertLead`.
 */
async function prefetchExistingContactState(
  prisma: PrismaClient,
  organizationId: string,
  sourceType: ScrapeSourceType,
  candidates: RawCandidate[],
): Promise<Map<string, ExistingContactState>> {
  const placeIds: string[] = [];
  const dedupUrls = new Set<string>();
  const nameCityStateCandidates: RawCandidate[] = [];

  for (const candidate of candidates) {
    if (candidate.placeId) {
      placeIds.push(candidate.placeId);
      continue;
    }
    const dedupUrl = normalizeUrlForDedup(candidate.url ?? candidate.website ?? null);
    if (dedupUrl) {
      dedupUrls.add(dedupUrl);
    } else {
      nameCityStateCandidates.push(candidate);
    }
  }

  const orConditions: Prisma.LeadWhereInput[] = [];
  if (placeIds.length > 0) {
    orConditions.push({ placeId: { in: placeIds } });
  }
  for (const dedupUrl of dedupUrls) {
    orConditions.push({ sourceType, rawSnapshot: { path: ['_dedupUrl'], equals: dedupUrl } });
  }
  for (const candidate of nameCityStateCandidates) {
    orConditions.push({
      sourceType,
      name: { equals: candidate.name, mode: 'insensitive' },
      city: candidate.city,
      state: candidate.state,
    });
  }

  if (orConditions.length === 0) {
    return new Map();
  }

  const rows = await prisma.lead.findMany({
    where: { organizationId, OR: orConditions },
    select: { placeId: true, rawSnapshot: true, name: true, city: true, state: true, whatsapp: true, socialLinks: true },
  });

  const index = new Map<string, ExistingContactState>();
  for (const row of rows) {
    const state: ExistingContactState = { whatsapp: row.whatsapp, socialLinks: row.socialLinks };
    if (row.placeId) {
      index.set(`placeId:${row.placeId}`, state);
      continue;
    }
    const dedupUrl = (row.rawSnapshot as Record<string, unknown> | null)?.['_dedupUrl'];
    if (typeof dedupUrl === 'string') {
      index.set(`url:${dedupUrl}`, state);
      continue;
    }
    index.set(`name:${row.name.toLowerCase()}|${row.city ?? ''}|${row.state ?? ''}`, state);
  }
  return index;
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
    websiteConfirmedAbsent: candidate.websiteConfirmedAbsent,
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
    // Contato/redes (Task 9): `undefined` (não `null`) quando o candidato
    // não trouxe nada de novo NESTA passada — Prisma ignora chaves
    // `undefined` tanto em `create` quanto em `update`, então isto nunca
    // apaga um valor já salvo de uma execução anterior (ex.: um rescan que
    // não re-descobre o WhatsApp não deve zerar o que já tinha sido
    // encontrado antes). Só sobrescreve quando `discoverContactAndSocials`
    // de fato encontrou algo nesta execução.
    email: candidate.email ?? undefined,
    whatsapp: candidate.whatsapp ?? undefined,
    socialLinks: candidate.socialLinks
      ? (candidate.socialLinks as unknown as Prisma.InputJsonValue)
      : undefined,
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
 * Teto de rascunhos automáticos de outreach enfileirados POR JOB de scraping
 * (B4/Task 11) — constante de módulo, contada só dentro da execução atual
 * (não precisa de estado entre execuções, ver brief): evita que um único
 * `ScrapeJob` gigante (centenas/milhares de leads) enfileire uma avalanche de
 * rascunhos de uma vez só. Um `ScrapeJob` que qualifica mais de 10 leads
 * elegíveis simplesmente para de enfileirar depois do décimo — os demais
 * ficam sem rascunho automático desta passada (podem ganhar um manualmente,
 * ou num rescan futuro se ainda não tiverem `OutreachMessage`).
 */
const AUTODRAFT_MAX_PER_ORG_PER_JOB = 10;

/**
 * Resolve o canal de outreach do gatilho automático (B4/Task 11) por
 * prioridade fixa — WHATSAPP > INSTAGRAM_DM > LINKEDIN_DM > EMAIL > PHONE,
 * primeiro campo preenchido — a partir do `Lead` já persistido (pós-
 * `upsertLead`). `PHONE` é a prioridade mais baixa (ruling pós-review,
 * substitui a decisão original desta função): dado real de seed mostra
 * bastante negócio só-com-telefone, que sem este tier nunca ganharia
 * rascunho automático nenhum — `OutreachChannel` já suporta `PHONE`, então
 * não há razão pra deixar esses leads de fora. `null` só quando NENHUM dos
 * cinco campos está preenchido — o chamador trata `null` como "sem canal
 * elegível", nunca força um canal fora desta lista.
 */
function resolveAutodraftChannel(lead: {
  whatsapp: string | null;
  email: string | null;
  phone: string | null;
  socialLinks: Prisma.JsonValue;
}): OutreachChannel | null {
  if (lead.whatsapp) {
    return 'WHATSAPP';
  }
  const socialLinks = Array.isArray(lead.socialLinks) ? (lead.socialLinks as unknown as SocialLink[]) : [];
  if (socialLinks.some((link) => link.platform === 'INSTAGRAM')) {
    return 'INSTAGRAM_DM';
  }
  if (socialLinks.some((link) => link.platform === 'LINKEDIN')) {
    return 'LINKEDIN_DM';
  }
  if (lead.email) {
    return 'EMAIL';
  }
  if (lead.phone) {
    return 'PHONE';
  }
  return null;
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
 *   3. tx curta — persiste os leads (upsert + score + enrichment) e, para
 *      cada lead recém-QUALIFIED com oferta sugerida e canal de contato (ver
 *      `resolveAutodraftChannel`), acumula um job de rascunho automático de
 *      outreach (B4/Task 11) — SEM chamar `enqueueAutodraft` ainda dentro da
 *      tx (é uma chamada de rede ao Redis; a mesma disciplina de não segurar
 *      a tx Postgres aberta durante rede que justifica as 3 tx curtas acima).
 *   3.5 SEM transação — enfileira os jobs de rascunho automático acumulados
 *      no passo 3 (best-effort por job: uma falha ao enfileirar não derruba
 *      o `ScrapeJob`, que já persistiu os leads corretamente).
 *   4. tx curta — marca o job em status terminal; fora dela, registra gasto
 *      no orçamento e grava AuditLog.
 *
 * Qualquer erro não capturado no meio (rede, transação revertida, bug):
 * o `catch` externo marca FAILED via `prisma` direto (nunca dentro de uma
 * tx já revertida) — o job SEMPRE termina em status terminal, nunca fica
 * "pendurado" em QUEUED/RUNNING.
 *
 * `enqueueAutodraft`: produtor da fila `outreach-autodraft` (Task 11,
 * `outreach-autodraft-queue.ts`) — injetado (não instanciado aqui) para que
 * este módulo continue puro/testável sem mockar BullMQ; default no-op só
 * para não quebrar os testes/chamadores existentes de antes da Task 11.
 */
export async function processLeadScrapeJob(
  prisma: PrismaClient,
  gateways: LeadScrapeGateways,
  redis: Redis,
  data: LeadScrapeJobData,
  enqueueAutodraft: (job: OutreachAutodraftJobData) => Promise<unknown> = async () => undefined,
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
        // `monthlyBudget` só chega aqui não-nulo (`isOverBudget` nunca corta
        // com orçamento null — ver `budget.ts`), mas o tipo é `number | null`;
        // o `!== null` é só pra satisfazer o TypeScript sem um `!`, o ramo
        // `else` (log do valor `null` cru) nunca deve de fato rodar em
        // produção. `.toFixed(2)` formata o valor (ex.: "US$ 50.00", não
        // "US$ 50").
        errorMessage: `Orçamento mensal de scraping (US$ ${monthlyBudget !== null ? monthlyBudget.toFixed(2) : monthlyBudget}) já atingido para esta organização — job não executado, nada foi gasto.`,
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

    // Pré-fetch BATCHED (uma query só, nunca N) do estado de contato/redes
    // de `Lead`s JÁ EXISTENTES — evita re-gastar orçamento em
    // `discoverContactAndSocials` (mais abaixo) pra negócios que um re-scan
    // anterior (ex.: cooldown da Task 7) já enriqueceu. Ver comentário de
    // `prefetchExistingContactState` pro racional completo. Só faz sentido
    // pra fontes estruturadas — Camoufox nunca passa por
    // `discoverContactAndSocials` de qualquer forma (ver mais abaixo).
    const existingContactState = isStructuredWebsiteSource
      ? await prefetchExistingContactState(prisma, data.organizationId, scrapeJob.sourceType, candidates)
      : new Map<string, ExistingContactState>();

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
      // Descoberta de contato/redes (Task 9) — só fontes estruturadas.
      // Camoufox NUNCA passa por aqui: não é uma "fonte estruturada" (não
      // tem `website`/`placeId` confiáveis o bastante pra raspar contato
      // contra), exatamente como o resto do enrichment de firmografia acima
      // já trata — intencional, não uma lacuna.
      //
      // `!candidate.whatsapp && !candidate.socialLinks` sozinho NUNCA seria
      // suficiente pra evitar re-gastar orçamento num re-scan: nenhuma das
      // três fontes de busca preenche esses campos no `RawCandidate` recém-
      // mapeado (são sempre `null` aqui, mesmo pra um negócio já enriquecido
      // antes) — por isso o `!existingContactState.get(...)` abaixo, que
      // consulta o `Lead` JÁ EXISTENTE (pré-fetch batched logo acima do
      // loop) é a checagem que de fato importa pra custo; a checagem do
      // candidato continua como proteção adicional caso um gateway futuro
      // passe a trazer isso já na busca.
      let contactEnrichment: ContactEnrichmentResult | null = null;
      const existingForCandidate = existingContactState.get(candidateDedupKey(candidate));
      // Semântica OU, nunca E: QUALQUER dado de contato já descoberto
      // significa "já tentamos enriquecer este negócio, não gaste de novo".
      // Exigir os DOIS campos vazava orçamento de verdade — o caminho de
      // fallback (Camoufox), que é o dominante hoje (`onlyWithoutWebsite`
      // default `true`), tipicamente preenche `socialLinks` SEM achar nenhum
      // link `wa.me`, deixando `whatsapp` null; com `&&` esses leads eram
      // re-enriquecidos (e re-cobrados) a cada re-scan por cooldown do
      // `ProspectingTarget` (Task 7), para sempre.
      const alreadyHasContactData =
        !!existingForCandidate &&
        (!!existingForCandidate.whatsapp || hasPopulatedSocialLinks(existingForCandidate.socialLinks));
      if (
        STRUCTURED_WEBSITE_SOURCES.has(scrapeJob.sourceType) &&
        !candidate.whatsapp &&
        !candidate.socialLinks &&
        !alreadyHasContactData
      ) {
        try {
          contactEnrichment = await discoverContactAndSocials(
            candidate,
            gateways.contactEnrichment,
            gateways.camofox,
            redis,
            data.organizationId,
            monthlyBudget,
          );
        } catch {
          // Rede de segurança extra — `discoverContactAndSocials` já nunca
          // lança por si só (todo caminho interno tem seu próprio
          // try/catch), mas mantém a mesma disciplina defensiva do resto
          // deste loop.
          contactEnrichment = null;
        }
      }

      enriched.push({ candidate, firmographics, enrichmentRaw, contactEnrichment });
    }

    // Passo 3 — tx curta: persiste os leads (upsert + score + enrichment) e
    // acumula (sem enfileirar ainda — ver Passo 3.5) os jobs de rascunho
    // automático de outreach (B4/Task 11).
    const { count: leadsFound, autodraftJobs } = await withTenantContext(
      prisma,
      data.organizationId,
      async (tx) => {
        const offerings = await tx.serviceOffering.findMany({
          where: { organizationId: data.organizationId, isActive: true },
        });
        const offeringsIcp = offerings.map(toOfferingIcp);

        // Roteamento (Trilha B, plano pensando-como-empresa-com-agile-beaver.md)
        // — mesmo racional de round-robin por carga de `LeadsService.autoAssign`
        // (apps/api), resolvido aqui manualmente porque o worker não pode
        // importar de apps/api. Candidatos + contagem inicial buscados UMA VEZ
        // por job (não por lead) — a contagem é incrementada em memória
        // conforme cada lead do PRÓPRIO lote é atribuído, pra distribuir de
        // verdade dentro de um lote grande sem martelar o banco a cada
        // iteração nem sempre cair no mesmo membro por empate persistente.
        const eligibleMembers = await tx.membership.findMany({
          where: { organizationId: data.organizationId, role: { in: [...WRITE_ROLES] } },
          orderBy: { createdAt: 'asc' },
          select: { userId: true },
        });
        const openLeadCounts = new Map<string, number>();
        if (eligibleMembers.length > 0) {
          const counts = await tx.lead.groupBy({
            by: ['assignedUserId'],
            where: {
              organizationId: data.organizationId,
              assignedUserId: { in: eligibleMembers.map((m) => m.userId) },
              status: { notIn: ['CONVERTED', 'LOST'] },
            },
            _count: { _all: true },
          });
          for (const row of counts as Array<{ assignedUserId: string | null; _count: { _all: number } }>) {
            if (row.assignedUserId) {
              openLeadCounts.set(row.assignedUserId, row._count._all);
            }
          }
        }

        let count = 0;
        const autodraftJobs: OutreachAutodraftJobData[] = [];
        for (const { candidate, firmographics, enrichmentRaw, contactEnrichment } of enriched) {
          let lead = await upsertLead(tx, data, scrapeJob.sourceType, candidate, firmographics, offeringsIcp);

          // Só atribui quem ainda não tem dono — nunca sobrescreve uma
          // atribuição já existente (manual ou de uma passada anterior),
          // mesma regra de `LeadsService.autoAssign`.
          if (!lead.assignedUserId && eligibleMembers.length > 0) {
            const assigneeId = pickRoundRobinAssignee(
              eligibleMembers.map((m) => ({ userId: m.userId, openLeadCount: openLeadCounts.get(m.userId) ?? 0 })),
            );
            if (assigneeId) {
              lead = await tx.lead.update({ where: { id: lead.id }, data: { assignedUserId: assigneeId } });
              openLeadCounts.set(assigneeId, (openLeadCounts.get(assigneeId) ?? 0) + 1);
            }
          }

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
          if (contactEnrichment) {
            await tx.leadEnrichment.create({
              data: {
                organizationId: data.organizationId,
                leadId: lead.id,
                type: 'contact_enrichment',
                data: {
                  source: contactEnrichment.source,
                  ...contactEnrichment.data,
                } as unknown as Prisma.InputJsonValue,
                actorType: data.actorType,
                actorId: data.actorId ?? null,
              },
            });
          }
          count += 1;

          // Gatilho por evento do rascunho automático de outreach (B4/Task
          // 11) — dispara no exato momento em que ESTE lead vira QUALIFIED
          // com pelo menos um canal de contato suportado, dentro do mesmo
          // fluxo que já processa o lead (nunca um scan periódico separado,
          // ver Risks do plano). Três condições, todas exigidas:
          //   1. `lead.status === 'QUALIFIED'` (score cruzou o threshold).
          //   2. `lead.suggestedOfferingId` não-nulo — sem oferta sugerida,
          //      `OutreachService.generateDraft` lançaria BadRequestException
          //      (não teria o que promover na mensagem).
          //   3. `resolveAutodraftChannel` resolve um canal — ver seu
          //      comentário para a ordem de prioridade fixa.
          // E, adicionalmente: o lead ainda não tem NENHUM `OutreachMessage`
          // (checado via `count` — nunca reenfileira pra um lead que já
          // ganhou um rascunho, automático ou manual, numa passada anterior
          // ou neste mesmo job em caso de o lead já existir), e o teto
          // `AUTODRAFT_MAX_PER_ORG_PER_JOB` desta execução ainda não foi
          // atingido.
          if (
            lead.status === 'QUALIFIED' &&
            lead.suggestedOfferingId &&
            autodraftJobs.length < AUTODRAFT_MAX_PER_ORG_PER_JOB
          ) {
            const channel = resolveAutodraftChannel(lead);
            if (channel) {
              const existingOutreachCount = await tx.outreachMessage.count({ where: { leadId: lead.id } });
              if (existingOutreachCount === 0) {
                autodraftJobs.push({
                  organizationId: data.organizationId,
                  leadId: lead.id,
                  channel,
                  serviceOfferingId: lead.suggestedOfferingId,
                });
              }
            }
          }
        }
        return { count, autodraftJobs };
      },
    );

    // Passo 3.5 — SEM transação: enfileira os jobs de rascunho automático
    // acumulados acima (rede ao Redis, nunca dentro da tx Postgres — ver
    // comentário no topo da função). Best-effort por job: uma falha ao
    // enfileirar (Redis indisponível, etc.) nunca derruba o `ScrapeJob`, que
    // já persistiu os leads corretamente no Passo 3 — só reporta e segue,
    // mesma disciplina do bookkeeping de `finalizeJob` mais abaixo.
    for (const autodraftJob of autodraftJobs) {
      try {
        await enqueueAutodraft(autodraftJob);
      } catch (enqueueError) {
        Sentry.captureException(enqueueError, {
          extra: {
            leadId: autodraftJob.leadId,
            organizationId: data.organizationId,
            phase: 'outreach-autodraft-enqueue',
          },
        });
        // eslint-disable-next-line no-console -- visibilidade mínima mesmo sem SENTRY_DSN configurado (SDK vira no-op nesse caso)
        console.error(
          `[lead-scrape-processor] falha ao enfileirar rascunho automático de outreach para o lead ${autodraftJob.leadId}:`,
          enqueueError,
        );
      }
    }

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
