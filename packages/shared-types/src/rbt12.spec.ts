import { computeRbt12 } from './rbt12';

const flat = (from: number, to: number, cents: number) =>
  Object.fromEntries(
    Array.from({ length: to - from + 1 }, (_, i) => {
      const m = from + i;
      return [`2026-${String(m).padStart(2, '0')}`, cents];
    }),
  );

describe('computeRbt12', () => {
  it('soma os 12 meses anteriores, sem o mês de apuração', () => {
    const revenue = { ...flat(1, 12, 2_000_000), '2025-12': 2_000_000, '2027-01': 99_999_999 };
    const result = computeRbt12(revenue, '2027-01', '2024-03');
    expect(result.method).toBe('TWELVE_MONTHS');
    expect(result.rbt12Cents).toBe(24_000_000);
    expect(result.monthsConsidered).toEqual(Object.keys(flat(1, 12, 0)));
  });

  it('mês ausente conta como zero', () => {
    expect(computeRbt12({ '2026-06': 500_000 }, '2027-01', null).rbt12Cents).toBe(500_000);
  });

  it('no mês de início de atividade, usa a receita do próprio mês × 12', () => {
    const result = computeRbt12({ '2027-01': 1_000_000 }, '2027-01', '2027-01');
    expect(result).toEqual(expect.objectContaining({ method: 'START_MONTH', rbt12Cents: 12_000_000 }));
  });

  it('nos meses seguintes ao início, usa a média dos meses anteriores × 12', () => {
    const revenue = { '2027-01': 1_000_000, '2027-02': 2_000_000, '2027-03': 9_000_000 };
    const result = computeRbt12(revenue, '2027-03', '2027-01');
    expect(result).toEqual(
      expect.objectContaining({ method: 'START_AVERAGE', rbt12Cents: 18_000_000, monthsConsidered: ['2027-01', '2027-02'] }),
    );
  });

  it('com exatamente 12 meses de atividade, volta à regra normal', () => {
    const result = computeRbt12(flat(1, 12, 100), '2027-01', '2026-01');
    expect(result).toEqual(expect.objectContaining({ method: 'TWELVE_MONTHS', rbt12Cents: 1200 }));
  });
});
