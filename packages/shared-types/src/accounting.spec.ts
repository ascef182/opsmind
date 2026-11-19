import { DEFAULT_ACCOUNTING_DECISIONS, accountingCostComparison } from './accounting';

const reais = (v: number) => v * 100;

describe('accountingCostComparison', () => {
  const proposals = [
    { id: 'a', setupCents: reais(800), monthlyFeeCents: reais(450), annualCents: reais(450) },
    { id: 'b', setupCents: reais(2_500), monthlyFeeCents: reais(350), annualCents: 0 },
  ];

  it('soma honorários e tributos estimados no 1º ano e nos seguintes', () => {
    // R$ 20 mil/mês sem pró-labore: com Fator R o custo mensal é R$ 2.076 (DAS + INSS).
    const result = accountingCostComparison(proposals, { faturamentoMensalCents: reais(20_000), folhaMensalCents: 0, inssSocioRateBp: 1100 });

    expect(result.taxBasis).toBe('COM_FATOR_R');
    expect(result.monthlyTaxCents).toBe(reais(2_076));
    expect(result.proposals[0]).toEqual({
      id: 'a',
      feesFirstYearCents: reais(800 + 450 * 12 + 450),
      feesRecurringYearCents: reais(450 * 12 + 450),
      taxesYearCents: reais(2_076 * 12),
      firstYearCents: reais(800 + 450 * 12 + 450 + 2_076 * 12),
      recurringYearCents: reais(450 * 12 + 450 + 2_076 * 12),
    });
  });

  it('a proposta mais barata no 1º ano pode não ser a mais barata depois', () => {
    const result = accountingCostComparison(proposals, { faturamentoMensalCents: reais(10_000), folhaMensalCents: 0, inssSocioRateBp: 1100 });
    // a: 800 + 5.400 + 450 = 6.650 · b: 2.500 + 4.200 = 6.700 → a no 1º ano; b depois (4.200 < 5.850).
    expect(result.cheapestFirstYearId).toBe('a');
    expect(result.cheapestRecurringId).toBe('b');
  });

  it('sem economia do Fator R usa o custo atual', () => {
    const result = accountingCostComparison(proposals, { faturamentoMensalCents: reais(10_000), folhaMensalCents: reais(3_000), inssSocioRateBp: 1100 });
    expect(result.taxBasis).toBe('ATUAL');
  });

  it('sem propostas, nenhuma é a mais barata', () => {
    const result = accountingCostComparison([], { faturamentoMensalCents: reais(5_000), folhaMensalCents: 0, inssSocioRateBp: 1100 });
    expect(result.cheapestFirstYearId).toBeNull();
  });
});

describe('DEFAULT_ACCOUNTING_DECISIONS', () => {
  it('tem as 13 decisões com chaves únicas', () => {
    expect(DEFAULT_ACCOUNTING_DECISIONS).toHaveLength(13);
    expect(new Set(DEFAULT_ACCOUNTING_DECISIONS.map((d) => d.key)).size).toBe(13);
  });
});
