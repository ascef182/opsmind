import { normalizeRegionCode } from './region-codes';

describe('normalizeRegionCode', () => {
  it.each([
    ['São Paulo', 'BR', 'SP'],
    ['State of São Paulo', 'BR', 'SP'],
    ['state of sao paulo', null, 'SP'],
    ['Federal District', 'BR', 'DF'],
    ['Texas', 'US', 'TX'],
    ['New York', 'US', 'NY'],
    ['sp', null, 'SP'],
    ['TX', 'US', 'TX'],
  ])('%p (%p) → %p', (state, country, expected) => {
    expect(normalizeRegionCode(state, country)).toBe(expected);
  });

  it('o país desempata nomes que existem nos dois (Pará vs. nada; Georgia só nos EUA)', () => {
    expect(normalizeRegionCode('Georgia', 'US')).toBe('GA');
    expect(normalizeRegionCode('Pará', 'BR')).toBe('PA');
  });

  it('vazio vira null e valor desconhecido volta como veio', () => {
    expect(normalizeRegionCode('', 'BR')).toBeNull();
    expect(normalizeRegionCode(null)).toBeNull();
    expect(normalizeRegionCode('Ontario', 'CA')).toBe('Ontario');
  });
});
