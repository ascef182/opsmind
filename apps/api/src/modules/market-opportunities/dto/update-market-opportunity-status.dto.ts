import { IsIn } from 'class-validator';
import type { MarketOpportunityStatus } from '@opsmind/database';

// Mesma técnica de `ListOutreachMessagesQueryDto`/`GenerateOutreachDto`:
// array literal do enum do Prisma (não há `@IsEnum` sobre o enum gerado do
// client aqui, `@IsIn` valida contra a lista abaixo) — `class-validator`
// rejeita qualquer valor fora dela com 400 antes de chegar ao service.
const MARKET_OPPORTUNITY_STATUSES: MarketOpportunityStatus[] = [
  'NEW',
  'REVIEWING',
  'PURSUING',
  'DISMISSED',
];

export class UpdateMarketOpportunityStatusDto {
  @IsIn(MARKET_OPPORTUNITY_STATUSES)
  status!: MarketOpportunityStatus;
}
