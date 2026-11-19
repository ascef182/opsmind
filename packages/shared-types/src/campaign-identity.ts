import { normalizeRegionCode } from './region-codes';

// Identidade de uma campanha de prospecção: segmento + cidade + estado.
// Mesma normalização usada pela migration 20261118130200 (pg_temp.cm_fold /
// cm_uf): minúsculas, sem acento, espaços colapsados, estado como sigla.
export function foldIdentityText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function campaignStateCode(state: string, countryCode?: string | null): string {
  return normalizeRegionCode(state, countryCode) ?? state.trim();
}

export function campaignIdentityKey(segment: string, city: string, state: string): string {
  return [foldIdentityText(segment), foldIdentityText(city), foldIdentityText(campaignStateCode(state))].join('|');
}

export function campaignDisplayName(segment: string, city: string, state: string): string {
  return `${segment.trim()} — ${city.trim()}/${campaignStateCode(state)}`;
}

export const CAMPAIGN_STATUSES = ['ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED'] as const;
export type CampaignStatusValue = (typeof CAMPAIGN_STATUSES)[number];

export const CAMPAIGN_KINDS = ['STANDARD', 'GENERAL', 'LEGACY', 'MANUAL_ENTRY'] as const;
export type CampaignKindValue = (typeof CAMPAIGN_KINDS)[number];

export type CampaignLifecycleAction = 'pause' | 'resume' | 'complete' | 'reopen' | 'archive';

// Transições permitidas por ação. Só campanhas STANDARD mudam de status pela tela.
export const CAMPAIGN_LIFECYCLE: Record<CampaignLifecycleAction, { from: CampaignStatusValue[]; to: CampaignStatusValue }> = {
  pause: { from: ['ACTIVE'], to: 'PAUSED' },
  resume: { from: ['PAUSED'], to: 'ACTIVE' },
  complete: { from: ['ACTIVE', 'PAUSED'], to: 'COMPLETED' },
  reopen: { from: ['COMPLETED'], to: 'PAUSED' },
  archive: { from: ['ACTIVE', 'PAUSED', 'COMPLETED'], to: 'ARCHIVED' },
};
