// Espelha os models Lead/ScrapeJob/OutreachMessage/ServiceOffering/LeadEnrichment
// de apps/api (@opsmind/database) — mesma decisão de lib/customers/types.ts:
// tipos duplicados localmente ao front em vez de importados do Prisma.
import type { Role } from '@opsmind/shared-types';
import type { LeadScoreBreakdown } from '@opsmind/shared-types';

// Todo papel exceto VIEWER pode disparar as ações de escrita deste módulo
// (score/enrich/analyze/convert/gerar-aprovar-rejeitar outreach, criar
// ScrapeJob) — espelha `WRITE_ROLES` de
// apps/api/src/shared/constants/roles.constant.ts. Não há export
// compartilhado disso em @opsmind/shared-types (só `ROLE_HIERARCHY`), então
// duplicamos aqui como o resto do front já faz com listas de papéis
// ad-hoc por página (ver `MANAGER_ROLES` em team/page.tsx).
export const WRITE_ROLES: Role[] = ['OWNER', 'ADMIN', 'MANAGER', 'MEMBER'];

export type ScrapeSourceType =
  | 'APIFY_GOOGLE_MAPS'
  | 'EXPLORIUM_BUSINESS_SEARCH'
  | 'CAMOFOX_GOOGLE_SEARCH'
  | 'CAMOFOX_REDDIT_SEARCH'
  | 'MANUAL';

// As 4 fontes automatizáveis por `POST .../scrape-jobs` — MANUAL fica de
// fora de propósito, mesmo racional do comentário em
// create-scrape-job.dto.ts (MANUAL só é usado internamente quando um Lead é
// criado à mão via `POST .../leads`).
export const AUTOMATABLE_SOURCE_TYPES: Exclude<ScrapeSourceType, 'MANUAL'>[] = [
  'APIFY_GOOGLE_MAPS',
  'EXPLORIUM_BUSINESS_SEARCH',
  'CAMOFOX_GOOGLE_SEARCH',
  'CAMOFOX_REDDIT_SEARCH',
];

export const SCRAPE_SOURCE_LABELS: Record<ScrapeSourceType, string> = {
  APIFY_GOOGLE_MAPS: 'Apify — Google Maps',
  EXPLORIUM_BUSINESS_SEARCH: 'Explorium — Busca B2B',
  CAMOFOX_GOOGLE_SEARCH: 'Camoufox — Busca no Google',
  CAMOFOX_REDDIT_SEARCH: 'Camoufox — Busca no Reddit',
  MANUAL: 'Manual',
};

export type ScrapeJobStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export type LeadStatus =
  | 'DISCOVERED'
  | 'QUALIFIED'
  | 'DISQUALIFIED'
  | 'OUTREACH_DRAFTED'
  | 'OUTREACH_APPROVED'
  | 'CONTACTED'
  | 'REPLIED'
  | 'CONVERTED'
  | 'LOST';

export type OutreachChannel =
  | 'EMAIL'
  | 'PHONE'
  | 'WHATSAPP'
  | 'LINKEDIN_DM'
  | 'REDDIT_DM'
  | 'INSTAGRAM_DM'
  | 'OTHER';

export const OUTREACH_CHANNELS: OutreachChannel[] = [
  'EMAIL',
  'PHONE',
  'WHATSAPP',
  'LINKEDIN_DM',
  'REDDIT_DM',
  'INSTAGRAM_DM',
  'OTHER',
];

export type OutreachStatus = 'DRAFT' | 'APPROVED' | 'REJECTED' | 'SENT' | 'REPLIED';

// Espelha `SOCIAL_PLATFORMS`/`SocialLink` de
// packages/shared-types/src/social-link.types.ts — duplicado localmente
// (mesma convenção do topo deste arquivo) em vez de importado, apesar de já
// existir em @opsmind/shared-types.
export type SocialPlatform = 'INSTAGRAM' | 'FACEBOOK' | 'LINKEDIN' | 'WHATSAPP' | 'TIKTOK' | 'TWITTER' | 'YOUTUBE' | 'OTHER';

export interface SocialLink {
  platform: SocialPlatform;
  url: string;
}

export interface ServiceOffering {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  signals: string[];
  targetIndustries: string[];
  minEmployees: number | null;
  maxEmployees: number | null;
  minRevenueUsd: number | null;
  maxRevenueUsd: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateServiceOfferingInput {
  name: string;
  description?: string;
  signals?: string[];
  targetIndustries?: string[];
  minEmployees?: number;
  maxEmployees?: number;
  minRevenueUsd?: number;
  maxRevenueUsd?: number;
}

export interface UpdateServiceOfferingInput extends Partial<CreateServiceOfferingInput> {
  isActive?: boolean;
}

export interface ScrapeJob {
  id: string;
  organizationId: string;
  sourceType: ScrapeSourceType;
  city: string;
  state: string;
  businessType: string;
  onlyWithoutWebsite: boolean;
  limit: number;
  status: ScrapeJobStatus;
  leadsFound: number;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateScrapeJobInput {
  sourceType: Exclude<ScrapeSourceType, 'MANUAL'>;
  city: string;
  state: string;
  businessType: string;
  onlyWithoutWebsite?: boolean;
  limit?: number;
}

export interface ListScrapeJobsFilter {
  status?: ScrapeJobStatus;
}

// Espelha `ProspectingTarget` (packages/database/prisma/schema.prisma) — a
// config recorrente que o worker (Task 7) varre pra disparar um ScrapeJob
// por alvo respeitando `cooldownDays`. CRUD puro (Task 6, já mergeada), sem
// campos derivados/estado de execução no model.
export interface ProspectingTarget {
  id: string;
  organizationId: string;
  city: string;
  state: string;
  businessType: string;
  sourceType: ScrapeSourceType;
  onlyWithoutWebsite: boolean;
  limit: number;
  isActive: boolean;
  cooldownDays: number;
  createdAt: string;
  updatedAt: string;
}

// Espelha CreateProspectingTargetDto — `sourceType` exclui MANUAL pelo mesmo
// motivo de CreateScrapeJobInput.
export interface CreateProspectingTargetInput {
  city: string;
  state: string;
  businessType: string;
  sourceType?: Exclude<ScrapeSourceType, 'MANUAL'>;
  onlyWithoutWebsite?: boolean;
  limit?: number;
  isActive?: boolean;
  cooldownDays?: number;
}

// Espelha UpdateProspectingTargetDto.
export type UpdateProspectingTargetInput = Partial<CreateProspectingTargetInput>;

export interface ListProspectingTargetsFilter {
  isActive?: boolean;
}

export interface LeadEnrichment {
  id: string;
  organizationId: string;
  leadId: string;
  type: string;
  // Formato depende de `type` — `{ text: string }` para 'ai_analysis'
  // (ver lead-analysis.service.ts), formato bruto do Explorium para
  // 'explorium_firmographics'. Sem união discriminada porque o back-end não
  // expõe um enum fechado de `type` (é `string` livre no schema).
  data: Record<string, unknown>;
  sourceUrl: string | null;
  createdAt: string;
}

export interface OutreachMessage {
  id: string;
  organizationId: string;
  leadId: string;
  serviceOfferingId: string | null;
  channel: OutreachChannel;
  subject: string | null;
  body: string;
  evidenceQuotes: string[];
  status: OutreachStatus;
  generatedByModel: string | null;
  approvedByUserId: string | null;
  approvedAt: string | null;
  rejectedReason: string | null;
  sentAt: string | null;
  repliedAt: string | null;
  // Leitura COMPARTILHADA de equipe (Trilha B, inbox compartilhada) — nunca
  // por usuário, ver comentário de `OutreachMessage.readAt` no schema.
  readAt: string | null;
  readByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  // Só presente em `GET .../outreach-messages` (a inbox compartilhada) —
  // ausente em `listForLead`/`findByIdOrThrow`, que não fazem esse join.
  lead?: { name: string; assignedUserId: string | null };
}

export interface GenerateOutreachInput {
  channel: OutreachChannel;
  serviceOfferingId?: string;
}

export interface RejectOutreachInput {
  reason?: string;
}

// Espelha EditOutreachDto — `body` obrigatório, `subject` opcional. Só é
// aceito pela API enquanto a mensagem está em DRAFT (Task 15).
export interface EditOutreachInput {
  body: string;
  subject?: string;
}

export interface ListOutreachMessagesFilter {
  status?: OutreachStatus;
  unread?: boolean;
  mine?: boolean;
}

export interface Lead {
  id: string;
  organizationId: string;
  scrapeJobId: string | null;
  sourceType: ScrapeSourceType;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  googleCategory: string | null;
  whatsapp: string | null;
  contactName: string | null;
  socialLinks: SocialLink[] | null;
  // `Decimal` do Prisma serializa como STRING no JSON de resposta (decimal.js
  // define `toJSON = toString`) — nunca `number` direto, mesmo a API interna
  // usando `Number(lead.rating)` antes de repassar pro scoring. Ver
  // `leads.service.ts`.
  rating: string | null;
  reviewCount: number | null;
  placeId: string | null;
  rawContent: string | null;
  status: LeadStatus;
  score: number | null;
  scoreBreakdown: LeadScoreBreakdown | null;
  suggestedOfferingId: string | null;
  convertedCustomerId: string | null;
  // Atribuição de dono (round-robin por carga na criação, reatribuível a
  // qualquer momento) — `null` só quando a organização não tinha nenhum
  // membro elegível (WRITE_ROLES) no momento da criação.
  assignedUserId: string | null;
  discoveredAt: string;
  createdAt: string;
  updatedAt: string;
  // Só presentes na resposta de `GET .../leads/:leadId` (findByIdOrThrow usa
  // `include: { enrichments: true, outreachMessages: true }`) — ausentes na
  // listagem (`GET .../leads`).
  enrichments?: LeadEnrichment[];
  outreachMessages?: OutreachMessage[];
}

export interface CreateLeadInput {
  name: string;
  address?: string;
  city?: string;
  state?: string;
  phone?: string;
  email?: string;
  website?: string;
  googleCategory?: string;
  rating?: number;
  reviewCount?: number;
  rawContent?: string;
}

export interface UpdateLeadInput {
  status?: LeadStatus;
  phone?: string;
  email?: string;
  website?: string;
}

export interface ConvertLeadInput {
  name?: string;
  company?: string;
}

export interface ListLeadsFilter {
  status?: LeadStatus;
  sourceType?: ScrapeSourceType;
  minScore?: number;
  city?: string;
  state?: string;
  hasWebsite?: boolean;
  // Espelha `hasContactMethod` de list-leads-query.dto.ts — pelo menos um
  // canal de contato utilizável (phone/email/whatsapp/socialLinks).
  hasContactMethod?: boolean;
  search?: string;
  // "Uma lista pra cada busca" — filtra pelo ScrapeJob de origem (painel
  // "Buscas recentes" em app/.../leads/page.tsx).
  scrapeJobId?: string;
}

// Espelha `Customer` de lib/customers/types.ts — só o suficiente para
// redirecionar após `POST .../leads/:leadId/convert`.
export interface ConvertedCustomer {
  id: string;
  organizationId: string;
  name: string;
}
