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
  total: number; // clamped 0-100
  matchedOfferingId: string | null;
  matchedSignals: string[]; // trechos que bateram, para exibir "por que esse score" na UI
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

  const rawTotal = hasNoWebsitePoints + icpFit.points + activityPoints + keywordFallback.points;
  const total = Math.max(0, Math.min(100, rawTotal));

  const winner = hasFirmographics ? icpFit : keywordFallback;

  return {
    hasNoWebsitePoints,
    icpFitPoints: icpFit.points,
    activityPoints,
    keywordMatchPoints: keywordFallback.points,
    total,
    matchedOfferingId: winner.matchedOfferingId,
    matchedSignals: winner.matchedSignals,
  };
}
