// Extração de sinais do HTML de um site de lead — regex sobre conteúdo já
// buscado (via `ssrfSafeFetch`), sem navegador, sem chamada de IA. Padrões
// adaptados de `harvey/collectors/profile.py` (ethanplusai/harvey, MIT) —
// ver docs/planning/2026-11-06-harvey-inteligencia-comercial.md §3.1.
//
// Confiança é sempre atribuída por regra fixa aqui, nunca por IA (mantém o
// scoring determinístico e auditável — `packages/shared-types/src/lead-scoring.ts`
// só conta sinal com `collector: WEBSITE_PROFILER`/`MANUAL`, nunca
// `AI_ANALYSIS`). Sinais de AUSÊNCIA (ex.: "sem Instagram") têm confiança
// deliberadamente mais baixa que sinais de PRESENÇA — ausência de evidência
// não é evidência de ausência: não achar um link de Instagram na home não
// prova que a empresa não tem Instagram, só que não foi encontrado nas
// páginas buscadas.
export interface FetchedPage {
  url: string;
  html: string;
}

export interface ExtractedSignal {
  signalCode: string;
  value: string | null;
  confidence: number;
  evidenceUrl: string | null;
  evidenceQuote: string | null;
}

// Trecho MÍNIMO citado como evidência, nunca a página inteira —
// minimização de dado pessoal (PRD-v2 §9.1): truncado aqui, na extração, não
// cortado depois de já ter sido gravado por inteiro.
const MAX_EVIDENCE_QUOTE_LENGTH = 200;

const WHATSAPP_LINK_PATTERN = /https?:\/\/(?:wa\.me|api\.whatsapp\.com)\/[^\s"'<>)]*/i;

function findFirstUrlMatch(pages: FetchedPage[], pattern: RegExp): { page: FetchedPage; url: string } | null {
  for (const page of pages) {
    const match = page.html.match(pattern);
    if (match) {
      return { page, url: match[0] };
    }
  }
  return null;
}

function truncateQuote(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > MAX_EVIDENCE_QUOTE_LENGTH
    ? `${trimmed.slice(0, MAX_EVIDENCE_QUOTE_LENGTH)}…`
    : trimmed;
}

function matchOutdatedCopyright(pages: FetchedPage[]): ExtractedSignal | null {
  const currentYear = new Date().getUTCFullYear();
  for (const page of pages) {
    const match = page.html.match(/(?:©|\bcopyright\b)[^\n<]{0,30}?(\d{4})/i);
    const yearText = match?.[1];
    if (!yearText) {
      continue;
    }
    const year = Number(yearText);
    // >1 ano atrás, não só "não é o ano corrente" — um site atualizado em
    // janeiro deste ano não deveria ser sinalizado por ainda não ter
    // trocado o copyright em fevereiro.
    if (Number.isFinite(year) && year >= 1990 && year < currentYear - 1) {
      return {
        signalCode: 'website.outdated_copyright_year',
        value: String(year),
        confidence: 0.8,
        evidenceUrl: page.url,
        evidenceQuote: truncateQuote(match[0]),
      };
    }
  }
  return null;
}

/**
 * Extrai sinais estruturados de um conjunto de páginas já buscadas do site
 * de um lead (tipicamente homepage + `/contato`, na ordem em que foram
 * buscadas — `pages[0]` é tratado como a homepage). Função pura: nenhuma
 * chamada de rede, nenhuma dependência de framework.
 */
export function extractWebsiteSignals(pages: FetchedPage[]): ExtractedSignal[] {
  const signals: ExtractedSignal[] = [];
  const homepage = pages[0];
  if (!homepage) {
    return signals;
  }

  if (!homepage.url.startsWith('https://')) {
    signals.push({
      signalCode: 'website.no_ssl',
      value: null,
      confidence: 1,
      evidenceUrl: homepage.url,
      evidenceQuote: null,
    });
  }

  const hasContactForm = pages.some((page) => /<form\b/i.test(page.html) || /mailto:/i.test(page.html));
  if (!hasContactForm) {
    signals.push({
      signalCode: 'website.no_contact_form',
      value: null,
      confidence: 0.6,
      evidenceUrl: homepage.url,
      evidenceQuote: null,
    });
  }

  const hasViewport = pages.some((page) => /<meta[^>]*name=["']viewport["']/i.test(page.html));
  if (!hasViewport) {
    signals.push({
      signalCode: 'website.no_mobile_viewport',
      value: null,
      confidence: 0.9,
      evidenceUrl: homepage.url,
      evidenceQuote: null,
    });
  }

  const hasInstagram = pages.some((page) => /instagram\.com\//i.test(page.html));
  if (!hasInstagram) {
    signals.push({
      signalCode: 'social.no_instagram',
      value: null,
      confidence: 0.5,
      evidenceUrl: homepage.url,
      evidenceQuote: null,
    });
  }

  // Sinal de PRESENÇA (não ausência) de propósito: pra um CRM com IA pra
  // WhatsApp (DeskComm), o alvo comercial é "o negócio JÁ atende cliente
  // pelo WhatsApp" (tem o que organizar/automatizar), não "o negócio não
  // tem WhatsApp" (nada pra essa oferta resolver ali). Confiança mais alta
  // que a maioria dos outros sinais (0.85) porque é evidência positiva
  // concreta (a URL real capturada), não inferência por ausência.
  const whatsappMatch = findFirstUrlMatch(pages, WHATSAPP_LINK_PATTERN);
  if (whatsappMatch) {
    signals.push({
      signalCode: 'social.has_whatsapp_link',
      value: whatsappMatch.url,
      confidence: 0.85,
      evidenceUrl: whatsappMatch.page.url,
      evidenceQuote: truncateQuote(whatsappMatch.url),
    });
  } else {
    signals.push({
      signalCode: 'social.no_whatsapp_link',
      value: null,
      confidence: 0.5,
      evidenceUrl: homepage.url,
      evidenceQuote: null,
    });
  }

  const copyrightSignal = matchOutdatedCopyright(pages);
  if (copyrightSignal) {
    signals.push(copyrightSignal);
  }

  return signals;
}
