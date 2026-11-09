// Scoring de leads — função pura, sem dependência de framework nenhuma
// (nada de Prisma/NestJS aqui) para que `apps/worker` (scraping em lote) e
// `apps/api` (`/leads/:id/score` sob demanda) usem exatamente o mesmo
// cálculo, bit-a-bit, sem risco de divergência entre os dois processos.

// Score mínimo para um lead ser considerado qualificado. Calculado aqui como
// constante compartilhada, mas a decisão QUALIFIED/DISQUALIFIED em si é do
// chamador (ver `LeadScoreBreakdown` abaixo) — `scoreLead` só calcula pontos.
export const QUALIFICATION_THRESHOLD = 50;

export interface LeadScoringInput {
  website: string | null;
  // `website === null` sozinho NÃO significa "confirmado sem site" — fontes
  // não-estruturadas (Camoufox) nunca capturam este campo, então `null` ali
  // só significa "nunca observado", não "verificado ausente". Este flag
  // existe pra separar os dois casos: só fontes que efetivamente expõem um
  // campo de site na própria busca (Apify Google Maps, Explorium) podem
  // setar `true` quando esse campo vier vazio. Achado real (2026-09):
  // antes deste campo, `hasNoWebsitePoints` dava os 50 pontos (= o próprio
  // QUALIFICATION_THRESHOLD) pra QUALQUER lead do Camoufox, sem exceção,
  // porque `website` era sempre `null` ali — todo lead dessa fonte nascia
  // QUALIFIED antes de qualquer conteúdo real ser avaliado.
  websiteConfirmedAbsent: boolean;
  googleCategory: string | null;
  rating: number | null;
  reviewCount: number | null;
  // Usado só no fallback de keyword-match (quando não há firmographics) —
  // conteúdo bruto trazido por fontes não-estruturadas como o Camoufox.
  rawContent: string | null;
  firmographics?: {
    industry?: string | null;
    employeeCount?: number | null;
    revenueUsd?: number | null;
  } | null;
  // Sinais do profiler de site (`LeadSignal`, ver docs/planning/2026-11-06-harvey-inteligencia-comercial.md)
  // JÁ FILTRADOS pelo CHAMADOR para vocabulário `CONFIRMED` e collector
  // determinístico (`WEBSITE_PROFILER`/`MANUAL`) — nunca `AI_ANALYSIS`.
  // `scoreLead()` não sabe nada sobre `LeadSignal`/`SignalCode` do banco,
  // só recebe o já resolvido (mesmo padrão de `firmographics` acima) — isso
  // é o que garante que uma inferência de IA nunca seja contada como fato
  // confirmado no cálculo determinístico do score.
  confirmedSignals?: LeadSignalForScoring[];
}

export interface LeadSignalForScoring {
  signalCode: string;
  // Já resolvido pelo chamador a partir de `SignalCode.defaultServiceOfferingId`.
  matchedOfferingId: string | null;
}

/**
 * Recorte de `ServiceOffering` (packages/database/prisma/schema.prisma)
 * relevante pro scoring. O chamador filtra por `isActive: true` antes de
 * montar esse array — `scoreLead` não sabe (nem precisa saber) sobre a flag,
 * trata toda offering recebida como candidata.
 */
export interface ServiceOfferingIcp {
  id: string;
  signals: string[];
  targetIndustries: string[];
  minEmployees: number | null;
  maxEmployees: number | null;
  minRevenueUsd: number | null;
  maxRevenueUsd: number | null;
}

export interface LeadScoreBreakdown {
  hasNoWebsitePoints: number;
  icpFitPoints: number;
  activityPoints: number;
  keywordMatchPoints: number;
  signalFitPoints: number;
  total: number; // clamped 0-100
  matchedOfferingId: string | null;
  matchedSignals: string[]; // trechos que bateram, para exibir "por que esse score" na UI
  matchedSignalCodes: string[]; // códigos de LeadSignal que contribuíram para signalFitPoints
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function isWithinRange(value: number, min: number | null, max: number | null): boolean {
  return (min === null || value >= min) && (max === null || value <= max);
}

interface OfferingMatchResult {
  points: number;
  matchedOfferingId: string | null;
  matchedSignals: string[];
}

const NO_MATCH: OfferingMatchResult = { points: 0, matchedOfferingId: null, matchedSignals: [] };

/**
 * `icpFitPoints` (até 30) — só roda quando o lead tem firmographics (fonte
 * estruturada: Apify/Explorium). 10 pts por critério satisfeito por
 * QUALQUER offering (industry, employee range, revenue range) — a pontuação
 * é global, não por offering. `matchedOfferingId` é só um recorte pra UI:
 * a offering que sozinha bateu mais critérios (empate = a primeira do
 * array), mesmo que outra offering tenha contribuído pontos isolados.
 */
function computeIcpFit(
  input: LeadScoringInput,
  offerings: ServiceOfferingIcp[],
): OfferingMatchResult {
  const firmographics = input.firmographics;
  if (!firmographics) return NO_MATCH;

  const industryTexts = [input.googleCategory, firmographics.industry]
    .filter((value): value is string => !!value && value.trim() !== '')
    .map(normalize);

  let anyIndustryMatch = false;
  let anyEmployeeMatch = false;
  let anyRevenueMatch = false;

  let bestOffering: { id: string; matchCount: number; signals: string[] } | null = null;

  for (const offering of offerings) {
    const localSignals: string[] = [];
    let localMatches = 0;

    const matchedTarget = offering.targetIndustries.find((target) => {
      const normTarget = normalize(target);
      return industryTexts.some((text) => text.includes(normTarget) || normTarget.includes(text));
    });
    if (matchedTarget) {
      localMatches += 1;
      anyIndustryMatch = true;
      localSignals.push(matchedTarget);
    }

    if (
      firmographics.employeeCount != null &&
      isWithinRange(firmographics.employeeCount, offering.minEmployees, offering.maxEmployees)
    ) {
      localMatches += 1;
      anyEmployeeMatch = true;
      localSignals.push(`funcionários: ${firmographics.employeeCount}`);
    }

    if (
      firmographics.revenueUsd != null &&
      isWithinRange(firmographics.revenueUsd, offering.minRevenueUsd, offering.maxRevenueUsd)
    ) {
      localMatches += 1;
      anyRevenueMatch = true;
      localSignals.push(`receita: ${firmographics.revenueUsd}`);
    }

    // Estritamente maior (não >=) garante que, em empate, a primeira
    // offering do array permanece vencedora.
    if (localMatches > 0 && (!bestOffering || localMatches > bestOffering.matchCount)) {
      bestOffering = { id: offering.id, matchCount: localMatches, signals: localSignals };
    }
  }

  const points = (anyIndustryMatch ? 10 : 0) + (anyEmployeeMatch ? 10 : 0) + (anyRevenueMatch ? 10 : 0);

  return {
    points,
    matchedOfferingId: bestOffering?.id ?? null,
    matchedSignals: bestOffering?.signals ?? [],
  };
}

/**
 * `keywordMatchPoints` (até 60) — fallback usado SÓ quando não há
 * firmographics (fonte não-estruturada, ex.: Camoufox): sem dado
 * estruturado pra casar contra o ICP, o sinal disponível é o texto bruto da
 * página. A offering com mais `signals[]` batidos vence (empate = a
 * primeira do array, garantido pelo `>` estrito abaixo); a pontuação é
 * proporcional a quanto da lista de sinais DAQUELA offering bateu, não do
 * total entre todas as offerings.
 *
 * Texto de busca = `rawContent` (Camoufox) + `googleCategory` (Apify)
 * concatenados — sem isso, um lead vindo só de fonte Apify (sem Explorium
 * pra firmographics, cenário real de quem só tem a chave da Apify
 * configurada) nunca teria `matchedOfferingId`: `rawContent` nunca é
 * preenchido por fontes estruturadas por design, e `computeIcpFit` já usa
 * `googleCategory` mas só roda quando `firmographics` existe — sem
 * Explorium, essa combinação nunca acontece.
 */
function computeKeywordFallback(
  input: LeadScoringInput,
  offerings: ServiceOfferingIcp[],
): OfferingMatchResult {
  const searchText = [input.rawContent, input.googleCategory]
    .filter((value): value is string => !!value && value.trim() !== '')
    .join(' ');
  if (!searchText) return NO_MATCH;
  const content = normalize(searchText);

  let winner: { offering: ServiceOfferingIcp; matchedSignals: string[] } | null = null;

  for (const offering of offerings) {
    if (offering.signals.length === 0) continue;
    const matchedSignals = offering.signals.filter((signal) => content.includes(normalize(signal)));
    if (matchedSignals.length === 0) continue;
    if (!winner || matchedSignals.length > winner.matchedSignals.length) {
      winner = { offering, matchedSignals };
    }
  }

  if (!winner) return NO_MATCH;

  const points = Math.round((winner.matchedSignals.length / winner.offering.signals.length) * 60);
  return { points, matchedOfferingId: winner.offering.id, matchedSignals: winner.matchedSignals };
}

// Até 20 pontos, 5 por sinal confirmado que bate uma oferta ativa —
// deliberadamente menor que os outros buckets (o sinal já é parcialmente
// refletido em icpFitPoints/keywordMatchPoints via `ServiceOffering.signals`
// quando aplicável; este bucket é o incremento por EVIDÊNCIA CONCRETA de
// investigação de site, não o bucket principal do score).
const SIGNAL_FIT_POINTS_PER_MATCH = 5;
const MAX_SIGNAL_FIT_POINTS = 20;

interface SignalFitResult {
  points: number;
  matchedSignalCodes: string[];
  // Oferta com mais sinais confirmados batendo, pra disputar o "vencedor"
  // geral do lead (ver `scoreLead`) contra o vencedor de icpFit/keywordFallback
  // — um sinal concreto de investigação de site pode ser evidência mais
  // forte que um match genérico de ICP/keyword, e sem isso a oferta sugerida
  // nunca refletia sinais, só firmografia/palavra-chave.
  bestOffering: { offeringId: string; matchedSignalCodes: string[] } | null;
}

function computeSignalFit(
  confirmedSignals: LeadSignalForScoring[] | undefined,
  offerings: ServiceOfferingIcp[],
): SignalFitResult {
  if (!confirmedSignals || confirmedSignals.length === 0) {
    return { points: 0, matchedSignalCodes: [], bestOffering: null };
  }
  const activeOfferingIds = new Set(offerings.map((offering) => offering.id));
  const matched = confirmedSignals.filter(
    (signal) => signal.matchedOfferingId !== null && activeOfferingIds.has(signal.matchedOfferingId),
  );
  const points = Math.min(MAX_SIGNAL_FIT_POINTS, matched.length * SIGNAL_FIT_POINTS_PER_MATCH);

  const byOffering = new Map<string, string[]>();
  for (const signal of matched) {
    const offeringId = signal.matchedOfferingId as string;
    const codes = byOffering.get(offeringId) ?? [];
    codes.push(signal.signalCode);
    byOffering.set(offeringId, codes);
  }
  let bestOffering: SignalFitResult['bestOffering'] = null;
  for (const [offeringId, codes] of byOffering) {
    // Estritamente maior garante que, em empate, a primeira oferta a
    // acumular sinais permanece vencedora (mesma convenção de `computeIcpFit`).
    if (!bestOffering || codes.length > bestOffering.matchedSignalCodes.length) {
      bestOffering = { offeringId, matchedSignalCodes: codes };
    }
  }

  return { points, matchedSignalCodes: matched.map((signal) => signal.signalCode), bestOffering };
}

/**
 * Calcula o score de qualificação de um lead (0-100). Híbrido e
 * determinístico por design — nunca chama IA (custaria budget sem controle
 * rodando em lote sobre milhares de leads por scrape job): usa firmographics
 * quando a fonte é estruturada (Apify/Explorium) e cai pro fallback de
 * keyword-match contra `ServiceOffering.signals` quando não é (Camoufox).
 *
 * A decisão de qualificação (`total >= QUALIFICATION_THRESHOLD ? 'QUALIFIED'
 * : 'DISQUALIFIED'`) é do chamador — esta função só calcula pontos.
 */
export function scoreLead(input: LeadScoringInput, offerings: ServiceOfferingIcp[]): LeadScoreBreakdown {
  // Sinal central do ICP desta feature: negócio sem site é o alvo (PRD da
  // feature — ver docs/superpowers/plans/2026-09-02-leads-prospecting-dashboard.md).
  // Só conta quando a AUSÊNCIA foi confirmada pela fonte (ver
  // `websiteConfirmedAbsent` acima) — nunca quando o dado simplesmente não
  // foi capturado. Checa os dois (não só a flag) como defesa em
  // profundidade barata: nunca premia "sem site" se `website` de fato tiver
  // um valor, mesmo que o chamador tenha setado a flag errado.
  const hasNoWebsitePoints =
    input.websiteConfirmedAbsent && (input.website === null || input.website === '') ? 50 : 0;

  const activityPoints =
    ((input.reviewCount ?? 0) > 0 ? 10 : 0) + ((input.rating ?? 0) >= 4.0 ? 10 : 0);

  const hasFirmographics = input.firmographics != null;

  // Mutuamente exclusivos: ICP fit exige dado estruturado; o fallback de
  // keyword só faz sentido na ausência dele.
  const icpFit = hasFirmographics ? computeIcpFit(input, offerings) : NO_MATCH;
  const keywordFallback = hasFirmographics ? NO_MATCH : computeKeywordFallback(input, offerings);

  const signalFit = computeSignalFit(input.confirmedSignals, offerings);

  const rawTotal =
    hasNoWebsitePoints + icpFit.points + activityPoints + keywordFallback.points + signalFit.points;
  const total = Math.max(0, Math.min(100, rawTotal));

  const baseWinner = hasFirmographics ? icpFit : keywordFallback;
  // A oferta sugerida ("vencedora") passa a considerar TRÊS fontes de
  // evidência, não só ICP/keyword: se os sinais confirmados de investigação
  // de site contribuíram mais pontos que o bucket de ICP/keyword, a oferta
  // que eles apontam vence — evidência concreta de site (ex.: link de
  // WhatsApp encontrado) pode ser mais forte que um match genérico de
  // palavra-chave contra a categoria do negócio.
  const winner =
    signalFit.points > baseWinner.points && signalFit.bestOffering
      ? { matchedOfferingId: signalFit.bestOffering.offeringId, matchedSignals: signalFit.bestOffering.matchedSignalCodes }
      : baseWinner;

  return {
    hasNoWebsitePoints,
    icpFitPoints: icpFit.points,
    activityPoints,
    keywordMatchPoints: keywordFallback.points,
    signalFitPoints: signalFit.points,
    total,
    matchedOfferingId: winner.matchedOfferingId,
    matchedSignals: winner.matchedSignals,
    matchedSignalCodes: signalFit.matchedSignalCodes,
  };
}
