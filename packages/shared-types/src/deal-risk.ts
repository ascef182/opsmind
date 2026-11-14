// Espelha os valores do enum DealStage do Prisma (packages/database) — duplicado aqui
// para manter o pacote shared-types livre de dependência de banco, mesmo padrão de AuditActorType.
export type DealStage = 'QUALIFICATION' | 'PROPOSAL' | 'NEGOTIATION' | 'CONTRACT_SENT' | 'WON' | 'LOST';

export type DealRiskBucket = 'ON_TRACK' | 'COOLING' | 'AT_RISK' | 'NOT_APPLICABLE';

// Tempo esperado em cada etapa antes de o deal ser considerado parado.
// WON e LOST nunca são lidos por computeDealRisk (retornam NOT_APPLICABLE antes),
// mas o Record precisa ser total.
export const DEFAULT_EXPECTED_STAGE_DURATION_HOURS: Record<DealStage, number> = {
  QUALIFICATION: 72,
  PROPOSAL: 120,
  NEGOTIATION: 168,
  CONTRACT_SENT: 72,
  WON: 0,
  LOST: 0,
};

// Fração do tempo esperado a partir da qual o deal entra em COOLING (esfriando).
export const COOLING_THRESHOLD_RATIO = 0.7;

const MS_PER_HOUR = 3_600_000;

export function computeDealRisk(
  deal: { stage: DealStage; stageEnteredAt: Date },
  now: Date,
  expectedStageDurationHours: Record<DealStage, number> = DEFAULT_EXPECTED_STAGE_DURATION_HOURS,
): DealRiskBucket {
  if (deal.stage === 'WON' || deal.stage === 'LOST') {
    return 'NOT_APPLICABLE';
  }

  const hoursInStage = (now.getTime() - deal.stageEnteredAt.getTime()) / MS_PER_HOUR;
  const expectedHours = expectedStageDurationHours[deal.stage];

  if (hoursInStage >= expectedHours) {
    return 'AT_RISK';
  }
  if (hoursInStage >= expectedHours * COOLING_THRESHOLD_RATIO) {
    return 'COOLING';
  }
  return 'ON_TRACK';
}
