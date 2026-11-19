import type { Campaign } from '@/lib/harvey/types';
import type { LeadStatus, OutreachStatus } from '@/lib/leads/types';

// Tipos locais da API de campanhas (mesmo racional de lib/customers/types.ts).

export interface CampaignStats {
  leadsFound: number;
  qualified: number;
  disqualified: number;
  pending: number;
  messagesPendingApproval: number;
  messagesApproved: number;
  messagesSent: number;
  messagesReplied: number;
  messagesRejected: number;
}

export type CampaignWithStats = Campaign & { stats: CampaignStats; targetCount: number };

export interface CampaignOverview {
  items: CampaignWithStats[];
  total: number;
  page: number;
  pageSize: number;
  totals: {
    campaigns: number;
    activeCampaigns: number;
    leads: number;
    qualified: number;
    messagesSent: number;
    messagesReplied: number;
  };
}

export interface CampaignOverviewFilter {
  search?: string;
  city?: string;
  segment?: string;
  status?: Campaign['status'];
  includeArchived?: boolean;
  page?: number;
}

export type LeadEntityType = 'BUSINESS' | 'PROFESSIONAL' | 'DIRECTORY' | 'INTERNAL_PAGE' | 'IRRELEVANT' | 'UNKNOWN';

export interface CampaignLeadRow {
  id: string;
  name: string;
  googleCategory: string | null;
  city: string | null;
  state: string | null;
  phone: string | null;
  whatsapp: string | null;
  website: string | null;
  score: number | null;
  status: LeadStatus;
  entityType: LeadEntityType;
  disqualificationReason: string | null;
  duplicateOfLeadId: string | null;
  discoveredAt: string;
  latestOutreachStatus: OutreachStatus | null;
  participation: { origin: CampaignLeadOrigin; firstFoundAt: string; lastFoundAt: string; timesFound: number };
}

export type CampaignLeadOrigin = 'SEARCH' | 'MANUAL' | 'BACKFILL_EXACT' | 'LEGACY';

export interface CampaignLeadsFilter {
  qualification?: 'qualified' | 'disqualified' | 'pending';
  entityType?: LeadEntityType;
  search?: string;
  minScore?: number;
  hasWebsite?: boolean;
  sort?: 'score' | 'discoveredAt' | 'name' | 'lastFoundAt';
  order?: 'asc' | 'desc';
  page?: number;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CampaignMessage {
  id: string;
  channel: string;
  subject: string | null;
  body: string;
  status: OutreachStatus;
  strategy: string | null;
  createdAt: string;
  approvedAt: string | null;
  sentAt: string | null;
  repliedAt: string | null;
  rejectedReason: string | null;
  lead: { id: string; name: string };
}

export interface DuplicateLeadSummary {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  phone: string | null;
  website: string | null;
  sourceType: string;
  status: LeadStatus;
  duplicateOfLeadId: string | null;
  discoveredAt: string;
  _count: { outreachMessages: number };
}

export interface DuplicateCandidate {
  id: string;
  reasons: Array<'SAME_WEBSITE' | 'SAME_PHONE_CITY'>;
  status: 'PENDING' | 'CONFIRMED' | 'DISMISSED';
  leadA: DuplicateLeadSummary;
  leadB: DuplicateLeadSummary;
}

export interface LeadParticipation {
  origin: CampaignLeadOrigin;
  firstFoundAt: string;
  lastFoundAt: string;
  timesFound: number;
  campaign: { id: string; name: string; kind: Campaign['kind']; status: Campaign['status'] };
}

export const CAMPAIGN_STATUS_LABELS: Record<Campaign['status'], string> = {
  ACTIVE: 'Ativa',
  PAUSED: 'Pausada',
  COMPLETED: 'Finalizada',
  ARCHIVED: 'Arquivada',
};

export const CAMPAIGN_KIND_LABELS: Record<Campaign['kind'], string | null> = {
  STANDARD: null,
  GENERAL: 'Geral (Fase 1)',
  LEGACY: 'Legado',
  MANUAL_ENTRY: 'Cadastro manual',
};

export const CREATION_SOURCE_LABELS: Record<Campaign['creationSource'], string> = {
  USER: 'Criada manualmente',
  AUTO_FROM_SEARCH: 'Criada por uma busca avulsa',
  MIGRATION: 'Criada na migração',
};

export const ORIGIN_LABELS: Record<CampaignLeadOrigin, string> = {
  SEARCH: 'Busca',
  MANUAL: 'Cadastro manual',
  BACKFILL_EXACT: 'Busca (migrado)',
  LEGACY: 'Sem origem comprovada',
};

export const ENTITY_TYPE_LABELS: Record<LeadEntityType, string> = {
  BUSINESS: 'Empresa',
  PROFESSIONAL: 'Profissional',
  DIRECTORY: 'Diretório',
  INTERNAL_PAGE: 'Página interna',
  IRRELEVANT: 'Irrelevante',
  UNKNOWN: 'Não classificado',
};

// Mesmos códigos de DISQUALIFICATION_REASONS (packages/shared-types).
export const DISQUALIFICATION_LABELS: Record<string, string> = {
  DIRECTORY_DOMAIN: 'Diretório ou portal',
  LISTICLE_TITLE: 'Lista ou artigo',
  INTERNAL_PAGE_PATH: 'Página interna de site',
  SEARCH_ENGINE_ARTIFACT: 'Resultado genérico',
  SCORE_BELOW_THRESHOLD: 'Pontuação abaixo do corte',
  DUPLICATE: 'Duplicata',
  MANUAL: 'Desqualificado manualmente',
};

export const DUPLICATE_REASON_LABELS: Record<DuplicateCandidate['reasons'][number], string> = {
  SAME_WEBSITE: 'Mesmo site',
  SAME_PHONE_CITY: 'Mesmo telefone e cidade',
};

export type CampaignAction = 'pause' | 'resume' | 'complete' | 'reopen' | 'archive';

export const ACTIONS_BY_STATUS: Record<Campaign['status'], CampaignAction[]> = {
  ACTIVE: ['pause', 'complete', 'archive'],
  PAUSED: ['resume', 'complete', 'archive'],
  COMPLETED: ['reopen', 'archive'],
  ARCHIVED: [],
};

export const ACTION_LABELS: Record<CampaignAction, string> = {
  pause: 'Pausar',
  resume: 'Retomar',
  complete: 'Finalizar',
  reopen: 'Reabrir',
  archive: 'Arquivar',
};
