// Classificação determinística de um resultado de busca antes de virar Lead.
// Tudo que não for empresa ou profissional nunca é qualificado, qualquer que
// seja o score, e o motivo fica gravado em Lead.disqualificationReason.

export const LEAD_ENTITY_TYPES = ['BUSINESS', 'PROFESSIONAL', 'DIRECTORY', 'INTERNAL_PAGE', 'IRRELEVANT', 'UNKNOWN'] as const;
export type LeadEntityTypeValue = (typeof LEAD_ENTITY_TYPES)[number];

export const DISQUALIFICATION_REASONS = {
  DIRECTORY_DOMAIN: 'Página de diretório ou portal',
  LISTICLE_TITLE: 'Lista ou artigo sobre a categoria',
  INTERNAL_PAGE_PATH: 'Página interna de site (contato, notícia, categoria)',
  SEARCH_ENGINE_ARTIFACT: 'Resultado genérico da busca',
  SCORE_BELOW_THRESHOLD: 'Pontuação abaixo do corte',
  DUPLICATE: 'Duplicata confirmada',
  MANUAL: 'Desqualificado manualmente',
} as const;
export type DisqualificationReason = keyof typeof DISQUALIFICATION_REASONS;

export interface LeadClassification {
  entityType: LeadEntityTypeValue;
  reason: DisqualificationReason | null;
}

export const KNOWN_DIRECTORY_DOMAINS: ReadonlySet<string> = new Set([
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
  'doctoralia.com.br',
  'guiatelefone.com',
  'boaconsulta.com',
  'encontrasp.com.br',
  'solutudo.com.br',
  'cylex.com.br',
  'econodata.com.br',
  'empresaqui.com.br',
  'cnpj.biz',
  'yelp.com',
  'tripadvisor.com.br',
  'tripadvisor.com',
  'ifood.com.br',
]);

// "As 20 melhores barbearias em São Paulo", "766 imobiliárias em São Paulo".
// Best-effort: um negócio com número no nome pode colidir.
export const LISTICLE_TITLE_PATTERN = /\bmelhores?\b|\btop\s*\d+\b|\b\d+\s+\S+.*\bem\b|\bmais recomendad[oa]s\b/i;

const INTERNAL_PAGE_SEGMENTS = new Set([
  'contato',
  'contact',
  'fale-conosco',
  'noticia',
  'noticias',
  'news',
  'blog',
  'categoria',
  'categorias',
  'category',
  'tag',
  'tags',
  'busca',
  'search',
  'artigo',
  'artigos',
]);

const SEARCH_ENGINE_TITLE_PATTERN = /^(see more on|ver mais em|próximo\s*\||next\s*\||https?:\/\/\S+\s+›)/i;
const PROFESSIONAL_TITLE_PATTERN = /^(dra?\.|doutora?\s)/i;

function parseUrl(raw: string | null | undefined): URL | null {
  if (!raw || raw.trim() === '') return null;
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
}

export function hostnameOf(raw: string | null | undefined): string | null {
  return parseUrl(raw)?.hostname.toLowerCase().replace(/^www\./, '') ?? null;
}

function isDirectoryHost(host: string): boolean {
  for (const domain of KNOWN_DIRECTORY_DOMAINS) {
    if (host === domain || host.endsWith(`.${domain}`)) return true;
  }
  return false;
}

export interface ClassifiableCandidate {
  name: string;
  /** URL do resultado de busca (Camofox) ou site da empresa. */
  url: string | null;
  /** Fonte estruturada (Google Maps/Explorium) já é uma ficha de empresa. */
  structuredSource: boolean;
}

export function classifyLeadCandidate(candidate: ClassifiableCandidate): LeadClassification {
  const url = parseUrl(candidate.url);
  const host = url?.hostname.toLowerCase().replace(/^www\./, '') ?? null;
  const title = candidate.name.trim();

  if (!candidate.structuredSource) {
    if (SEARCH_ENGINE_TITLE_PATTERN.test(title)) return { entityType: 'IRRELEVANT', reason: 'SEARCH_ENGINE_ARTIFACT' };
    if (host && isDirectoryHost(host)) return { entityType: 'DIRECTORY', reason: 'DIRECTORY_DOMAIN' };
    if (LISTICLE_TITLE_PATTERN.test(title)) return { entityType: 'DIRECTORY', reason: 'LISTICLE_TITLE' };
    const segments = (url?.pathname ?? '').toLowerCase().split('/').filter(Boolean);
    if (segments.some((segment) => INTERNAL_PAGE_SEGMENTS.has(segment))) {
      return { entityType: 'INTERNAL_PAGE', reason: 'INTERNAL_PAGE_PATH' };
    }
  }
  if (PROFESSIONAL_TITLE_PATTERN.test(title)) return { entityType: 'PROFESSIONAL', reason: null };
  return { entityType: 'BUSINESS', reason: null };
}

export function isQualifiableEntity(entityType: LeadEntityTypeValue): boolean {
  return entityType === 'BUSINESS' || entityType === 'PROFESSIONAL' || entityType === 'UNKNOWN';
}
