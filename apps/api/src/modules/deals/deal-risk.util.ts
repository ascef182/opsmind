import type { Deal } from '@opsmind/database';
import { computeDealRisk, type DealRiskBucket } from '@opsmind/shared-types';

export type DealWithRisk = Deal & { risk: DealRiskBucket };

export function attachDealRisk(deal: Deal, now: Date = new Date()): DealWithRisk {
  return { ...deal, risk: computeDealRisk({ stage: deal.stage, stageEnteredAt: deal.stageEnteredAt }, now) };
}
