import { activeAt, isActiveAt, periodsOverlap, planPeriodChange } from './opsgov-validity';

describe('isActiveAt / activeAt', () => {
  const periods = [
    { id: 'a', validFrom: '2024-01-01', validTo: '2027-01-01' },
    { id: 'b', validFrom: '2027-01-01', validTo: null },
  ];

  it('intervalo é semiaberto: o dia de validTo já pertence ao próximo', () => {
    expect(isActiveAt(periods[0]!, '2026-12-31')).toBe(true);
    expect(isActiveAt(periods[0]!, '2027-01-01')).toBe(false);
    expect(activeAt(periods, '2027-01-01')?.id).toBe('b');
  });

  it('antes do primeiro período não há vigente', () => {
    expect(activeAt(periods, '2023-12-31')).toBeNull();
  });
});

describe('periodsOverlap', () => {
  it('períodos encostados não se sobrepõem', () => {
    expect(periodsOverlap({ validFrom: '2024-01-01', validTo: '2025-01-01' }, { validFrom: '2025-01-01', validTo: null })).toBe(false);
  });

  it('período aberto sobrepõe qualquer um que comece depois dele', () => {
    expect(periodsOverlap({ validFrom: '2024-01-01', validTo: null }, { validFrom: '2030-01-01', validTo: '2031-01-01' })).toBe(true);
  });
});

describe('planPeriodChange', () => {
  it('sem histórico, abre o primeiro período sem fechar nada', () => {
    expect(planPeriodChange([], { validFrom: '2024-01-01', validTo: null })).toEqual({ ok: true, close: null });
  });

  it('fecha o vigente no dia em que o novo começa', () => {
    const current = { id: 'mei', validFrom: '2024-01-01', validTo: null };
    expect(planPeriodChange([current], { validFrom: '2027-01-01', validTo: null })).toEqual({
      ok: true,
      close: { period: current, validTo: '2027-01-01' },
    });
  });

  it('recusa novo início igual ou anterior ao do vigente (nada retroativo)', () => {
    const current = { validFrom: '2024-01-01', validTo: null };
    expect(planPeriodChange([current], { validFrom: '2024-01-01', validTo: null })).toEqual({
      ok: false,
      reason: 'NOT_AFTER_CURRENT_START',
    });
    expect(planPeriodChange([current], { validFrom: '2023-06-01', validTo: null })).toEqual({
      ok: false,
      reason: 'NOT_AFTER_CURRENT_START',
    });
  });

  it('recusa sobreposição com período já encerrado', () => {
    const history = [{ validFrom: '2020-01-01', validTo: '2024-01-01' }];
    expect(planPeriodChange(history, { validFrom: '2023-01-01', validTo: null })).toEqual({
      ok: false,
      reason: 'OVERLAPS_FUTURE_PERIOD',
    });
    expect(planPeriodChange(history, { validFrom: '2024-01-01', validTo: null })).toEqual({ ok: true, close: null });
  });

  it('recusa intervalo vazio ou invertido', () => {
    expect(planPeriodChange([], { validFrom: '2024-01-01', validTo: '2024-01-01' })).toEqual({
      ok: false,
      reason: 'INVALID_RANGE',
    });
  });
});
