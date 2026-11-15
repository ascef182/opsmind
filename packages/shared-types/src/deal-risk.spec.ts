import { computeDealRisk, DEFAULT_EXPECTED_STAGE_DURATION_HOURS } from './deal-risk';

describe('computeDealRisk', () => {
  it('retorna NOT_APPLICABLE para stage WON, independente do tempo parado', () => {
    const result = computeDealRisk({ stage: 'WON', stageEnteredAt: new Date('2000-01-01') }, new Date());
    expect(result).toBe('NOT_APPLICABLE');
  });

  it('retorna NOT_APPLICABLE para stage LOST', () => {
    const result = computeDealRisk({ stage: 'LOST', stageEnteredAt: new Date('2000-01-01') }, new Date());
    expect(result).toBe('NOT_APPLICABLE');
  });

  it('retorna ON_TRACK quando o tempo na etapa está bem abaixo do esperado', () => {
    const now = new Date('2026-01-10T00:00:00Z');
    const result = computeDealRisk({ stage: 'QUALIFICATION', stageEnteredAt: new Date('2026-01-09T12:00:00Z') }, now);
    expect(result).toBe('ON_TRACK');
  });

  it('retorna COOLING quando o tempo na etapa passa de 70% do esperado mas não atingiu 100%', () => {
    // QUALIFICATION default = 72h; 70% = 50.4h
    const now = new Date('2026-01-10T00:00:00Z');
    const result = computeDealRisk({ stage: 'QUALIFICATION', stageEnteredAt: new Date('2026-01-07T12:00:00Z') }, now);
    expect(result).toBe('COOLING');
  });

  it('retorna AT_RISK quando o tempo na etapa atinge ou passa do esperado', () => {
    const now = new Date('2026-01-10T00:00:00Z');
    const result = computeDealRisk({ stage: 'QUALIFICATION', stageEnteredAt: new Date('2026-01-01T00:00:00Z') }, now);
    expect(result).toBe('AT_RISK');
  });

  it('usa o override de horas por etapa quando fornecido, em vez do default', () => {
    const now = new Date('2026-01-10T00:00:00Z');
    const stageEnteredAt = new Date('2026-01-09T00:00:00Z'); // 24h parado
    const defaultResult = computeDealRisk({ stage: 'QUALIFICATION', stageEnteredAt }, now);
    const overridden = computeDealRisk(
      { stage: 'QUALIFICATION', stageEnteredAt },
      now,
      { ...DEFAULT_EXPECTED_STAGE_DURATION_HOURS, QUALIFICATION: 12 },
    );
    expect(defaultResult).toBe('ON_TRACK'); // 24h < 70% de 72h
    expect(overridden).toBe('AT_RISK'); // 24h >= 12h
  });
});
