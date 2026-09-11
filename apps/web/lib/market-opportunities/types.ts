// Espelha os models MarketOpportunity/RedditWatchTopic de apps/api
// (@opsmind/database) — mesma decisão de lib/leads/types.ts (tipos
// duplicados localmente ao front, não importados do Prisma). Diretório
// deliberadamente separado de lib/leads/: `MarketOpportunity` é uma entidade
// cross-lead, sem Lead/negócio específico associado (ver comentário de topo
// de market-opportunities.service.ts — ela nasce de clustering de menções no
// Reddit, não de um scrape de negócio local).
import type { Role } from '@opsmind/shared-types';

// Mesmo racional de WRITE_ROLES em lib/leads/types.ts: todo papel exceto
// VIEWER pode mudar `MarketOpportunity.status` ou gerenciar
// RedditWatchTopic — espelha `WRITE_ROLES` de
// apps/api/src/shared/constants/roles.constant.ts.
export const WRITE_ROLES: Role[] = ['OWNER', 'ADMIN', 'MANAGER', 'MEMBER'];

export type MarketOpportunityStatus = 'NEW' | 'REVIEWING' | 'PURSUING' | 'DISMISSED';

// `MarketOpportunity` só é criada/atualizada (mentionCount/sourceUrls/
// sampleQuotes) pelo RedditClusteringConsumer automático — o único campo que
// um humano controla via HTTP é `status` (PATCH .../:id/status). Ver
// comentário de topo de MarketOpportunitiesService.
export interface MarketOpportunity {
  id: string;
  organizationId: string;
  title: string;
  topicKey: string;
  problemDescription: string;
  mentionCount: number;
  sourceUrls: string[];
  // Coluna `Json` no schema, mas sempre gravada como array de strings pelo
  // consumer (`extractSampleQuotes`, reddit-clustering.consumer.ts) — nunca
  // um objeto/união discriminada.
  sampleQuotes: string[];
  status: MarketOpportunityStatus;
  suggestedOfferingId: string | null;
  discoveredAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface ListMarketOpportunitiesFilter {
  status?: MarketOpportunityStatus;
}

export interface UpdateMarketOpportunityStatusInput {
  status: MarketOpportunityStatus;
}

// Config recorrente que o worker varre (reddit-mining-scan.ts) pra buscar
// menções novas no Reddit sobre `query`/`subreddit` e alimentar o
// clustering — mesmo papel de `ProspectingTarget` só que pro pipeline de
// Reddit em vez de scraping de negócio local.
export interface RedditWatchTopic {
  id: string;
  organizationId: string;
  query: string;
  subreddit: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRedditWatchTopicInput {
  query: string;
  subreddit?: string;
  isActive?: boolean;
}

export type UpdateRedditWatchTopicInput = Partial<CreateRedditWatchTopicInput>;

export interface ListRedditWatchTopicsFilter {
  isActive?: boolean;
}
