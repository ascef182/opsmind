// Espelha os tipos de resposta de apps/api/src/modules/revenue (mesma decisão
// de tipos locais ao front de `lib/leads/types.ts`). Estágios e rótulos do
// funil vêm de @opsmind/shared-types, que é a fonte única deles.
import type { RevenuePipelineStage } from '@opsmind/shared-types';

export type RevenuePeriod = 'day' | 'week' | 'month';

export interface KpiValue {
  current: number;
  previous: number;
  availableFromPhase?: number;
}

export type MoneyByCurrency = Record<string, number>;

export type RevenueKpiKey =
  | 'discovered'
  | 'withoutWebsite'
  | 'weakWebsite'
  | 'qualified'
  | 'outreachPrepared'
  | 'messagesSent'
  | 'repliesReceived'
  | 'positiveReplies'
  | 'demosRequested'
  | 'previewsGenerated'
  | 'meetingsBooked'
  | 'proposalsSent'
  | 'dealsWon'
  | 'spendUsd';

export interface RevenueOverview {
  period: RevenuePeriod;
  kpis: Record<RevenueKpiKey, KpiValue>;
  revenue: { current: MoneyByCurrency; previous: MoneyByCurrency };
  openPipelineValue: MoneyByCurrency;
  acquisitionCostUsd: { current: number | null; previous: number | null };
}

export interface PipelineStageRow {
  stage: RevenuePipelineStage;
  label: string;
  current: number;
  entered: number;
  progressed: number;
  conversionRate: number | null;
  medianHoursInStage: number | null;
  nextAction: string;
}

export interface RevenuePipeline {
  stages: PipelineStageRow[];
  disqualified: number;
  flowWindowDays: number;
}

export type CostCategory = 'AI' | 'SCRAPING' | 'ENRICHMENT' | 'EMAIL' | 'SMS' | 'WHATSAPP' | 'PREVIEW' | 'STORAGE' | 'HOSTING';

export interface RevenueCosts {
  period: RevenuePeriod;
  totalUsd: number;
  byCategory: Array<{ category: CostCategory; amountUsd: number }>;
  daily: Array<{ date: string; amountUsd: number }>;
  unitCostsUsd: {
    perDiscoveredLead: number | null;
    perQualifiedLead: number | null;
    perPositiveReply: number | null;
    perWonDeal: number | null;
  };
}

export interface RevenueSettings {
  organizationId: string;
  outreachPaused: boolean;
  outreachPausedReason: string | null;
  dailySendLimit: number;
  dailyResearchLimit: number;
  engineMonthlyBudgetUsd: number;
  defaultOutreachCountry: string;
  globalPause: boolean;
}

export type RevenueSettingsPatch = Partial<
  Pick<
    RevenueSettings,
    | 'outreachPaused'
    | 'outreachPausedReason'
    | 'dailySendLimit'
    | 'dailyResearchLimit'
    | 'engineMonthlyBudgetUsd'
    | 'defaultOutreachCountry'
  >
>;

// Só esconde UI; a API é quem barra (PATCH exige OWNER/ADMIN).
export const REVENUE_SETTINGS_ROLES = ['OWNER', 'ADMIN'] as const;

export const COST_CATEGORY_LABEL: Record<CostCategory, string> = {
  AI: 'IA',
  SCRAPING: 'Pesquisa',
  ENRICHMENT: 'Enriquecimento',
  EMAIL: 'E-mail',
  SMS: 'SMS',
  WHATSAPP: 'WhatsApp',
  PREVIEW: 'Previews',
  STORAGE: 'Armazenamento',
  HOSTING: 'Hospedagem',
};
