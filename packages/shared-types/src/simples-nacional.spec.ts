import {
  SIMPLES_TABLES,
  SimplesSimulationError,
  anexoAplicavel,
  dasCents,
  effectiveRate,
  fatorR,
  simulate,
  tableAt,
  type SimplesTableVersion,
} from './simples-nacional';

const reais = (v: number) => v * 100;

describe('effectiveRate (ppm)', () => {
  it('R$ 5 mil/mês (RBT12 60 mil): 6% no III e 15,5% no V', () => {
    expect(effectiveRate(reais(60_000), 'III')).toBe(60_000);
    expect(effectiveRate(reais(60_000), 'V')).toBe(155_000);
  });

  it('R$ 20 mil/mês (RBT12 240 mil): 7,3% no III e 16,125% no V', () => {
    expect(effectiveRate(reais(240_000), 'III')).toBe(73_000);
    expect(effectiveRate(reais(240_000), 'V')).toBe(161_250);
  });

  it('nas bordas das faixas a alíquota efetiva é contínua', () => {
    // Topo da faixa 1 = nominal; início da faixa 2 = praticamente a mesma.
    expect(effectiveRate(reais(180_000), 'III')).toBe(60_000);
    expect(effectiveRate(reais(180_000) + 1, 'III')).toBe(60_000);
    expect(effectiveRate(reais(360_000), 'V')).toBe(167_500);
    expect(effectiveRate(reais(4_800_000), 'III')).toBe(195_000);
  });

  it('RBT12 zero usa a nominal da 1ª faixa', () => {
    expect(effectiveRate(0, 'V')).toBe(155_000);
  });

  it('acima de R$ 4,8 mi está fora do Simples', () => {
    expect(() => effectiveRate(reais(4_800_000) + 1, 'III')).toThrow(SimplesSimulationError);
  });
});

describe('dasCents', () => {
  it('calcula exato em centavos', () => {
    expect(dasCents(reais(20_000), reais(240_000), 'III')).toBe(reais(1_460));
    expect(dasCents(reais(20_000), reais(240_000), 'V')).toBe(reais(3_225));
    expect(dasCents(reais(5_000), reais(60_000), 'III')).toBe(reais(300));
  });
});

describe('fatorR / anexoAplicavel', () => {
  it('28% é o limiar, e o Fator R é truncado', () => {
    expect(fatorR(reais(67_200), reais(240_000))).toBe(2800);
    expect(anexoAplicavel(2800)).toBe('III');
    expect(fatorR(reais(67_200) - 1, reais(240_000))).toBe(2799);
    expect(anexoAplicavel(2799)).toBe('V');
  });

  it('sem receita, Fator R zero', () => {
    expect(fatorR(reais(1_000), 0)).toBe(0);
  });
});

describe('simulate', () => {
  it('R$ 20 mil/mês sem pró-labore: economia do Fator R = R$ 1.149/mês com INSS de 11%', () => {
    const result = simulate({ faturamentoMensalCents: reais(20_000), folhaMensalCents: 0, inssSocioRateBp: 1100 });
    expect(result.rbt12Cents).toBe(reais(240_000));
    expect(result.proLaboreMinimoCents).toBe(reais(5_600));
    expect(result.atual).toEqual({ anexo: 'V', folhaMensalCents: 0, dasCents: reais(3_225), inssSocioCents: 0, custoTotalCents: reais(3_225) });
    expect(result.comFatorR).toEqual({
      anexo: 'III',
      folhaMensalCents: reais(5_600),
      dasCents: reais(1_460),
      inssSocioCents: reais(616),
      custoTotalCents: reais(2_076),
    });
    expect(result.economiaMensalCents).toBe(reais(1_149));
  });

  it('folha já acima de 28%: fica no III e não há economia adicional', () => {
    const result = simulate({ faturamentoMensalCents: reais(10_000), folhaMensalCents: reais(3_000), inssSocioRateBp: 1100 });
    expect(result.fatorRBp).toBe(3000);
    expect(result.atual.anexo).toBe('III');
    expect(result.comFatorR).toEqual(result.atual);
    expect(result.economiaMensalCents).toBe(0);
  });

  it('usa o RBT12 real quando informado, sem assumir faturamento estável', () => {
    const result = simulate({
      faturamentoMensalCents: reais(20_000),
      folhaMensalCents: 0,
      inssSocioRateBp: 1100,
      rbt12Cents: reais(60_000),
    });
    expect(result.anexoIII.aliquotaEfetivaPpm).toBe(60_000);
    expect(result.anexoIII.dasCents).toBe(reais(1_200));
    expect(result.proLaboreMinimoCents).toBe(reais(1_400));
  });

  it('recusa entradas inválidas', () => {
    expect(() => simulate({ faturamentoMensalCents: -1, folhaMensalCents: 0, inssSocioRateBp: 1100 })).toThrow(SimplesSimulationError);
    expect(() => simulate({ faturamentoMensalCents: 1.5, folhaMensalCents: 0, inssSocioRateBp: 1100 })).toThrow(SimplesSimulationError);
    expect(() => simulate({ faturamentoMensalCents: 100, folhaMensalCents: 0, inssSocioRateBp: 10_001 })).toThrow(SimplesSimulationError);
  });
});

describe('tableAt (versões por vigência)', () => {
  const v2027: SimplesTableVersion = { ...SIMPLES_TABLES[0]!, validFrom: '2027-01-01', source: 'hipotética' };
  const tables = [SIMPLES_TABLES[0]!, v2027];

  it('escolhe a versão vigente na data, sem afetar datas anteriores', () => {
    expect(tableAt('2026-12-31', tables).validFrom).toBe('2018-01-01');
    expect(tableAt('2027-01-01', tables).validFrom).toBe('2027-01-01');
  });

  it('antes da primeira versão não há tabela', () => {
    expect(() => tableAt('2017-12-31')).toThrow(SimplesSimulationError);
  });
});
