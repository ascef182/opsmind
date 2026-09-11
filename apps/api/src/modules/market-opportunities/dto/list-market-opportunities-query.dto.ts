import { IsIn, IsOptional } from 'class-validator';
import type { MarketOpportunityStatus } from '@opsmind/database';

const MARKET_OPPORTUNITY_STATUSES: MarketOpportunityStatus[] = [
  'NEW',
  'REVIEWING',
  'PURSUING',
  'DISMISSED',
];

export class ListMarketOpportunitiesQueryDto {
  @IsOptional()
  @IsIn(MARKET_OPPORTUNITY_STATUSES)
  status?: MarketOpportunityStatus;
}
