// Simulador do Simples Nacional (Anexos III e V) — estimativa, não parecer
// contábil. Tabelas da LC 123/2006 na redação da LC 155/2016 (vigentes desde
// 2018-01-01), versionadas por vigência: uma mudança (ex.: 2027) entra como
// NOVA versão em SIMPLES_TABLES, sem alterar a anterior, e `tableAt(data)`
// escolhe a que valia na data — simulações e relatórios antigos não mudam.
//
// Unidades: dinheiro em centavos (Int), alíquota nominal em basis points
// (1% = 100 bp), alíquota efetiva em ppm (1% = 10.000 ppm), Fator R em bp.
// Contas intermediárias em BigInt: nenhum float em valor monetário.
//
// Fator R (LC 123, art. 18, §5º-J/M): atividades sujeitas a ele vão para o
// Anexo III quando folha12 / RBT12 >= 28%; senão, Anexo V. Aqui, "folha" é a
// folha de salários com pró-labore — o simulador não modela FGTS nem salários
// de empregados separadamente (entram somados em `folhaMensalCents`).

import { todayInSaoPaulo } from './finance';

export type AnexoSimulado = 'III' | 'V';

export interface SimplesBracket {
  /** Limite superior do RBT12 da faixa, inclusive, em centavos. */
  upToCents: number;
  nominalRateBp: number;
  deductionCents: number;
}

export interface SimplesTableVersion {
  validFrom: string;
  source: string;
  anexos: Record<AnexoSimulado, SimplesBracket[]>;
}

export const SIMPLES_LIMIT_CENTS = 480_000_000; // R$ 4,8 mi
export const FATOR_R_THRESHOLD_BP = 2800; // 28%

const reais = (value: number) => value * 100;

export const SIMPLES_TABLES: readonly SimplesTableVersion[] = [
  {
    validFrom: '2018-01-01',
    source: 'LC 123/2006, Anexos III e V, redação da LC 155/2016',
    anexos: {
      III: [
        { upToCents: reais(180_000), nominalRateBp: 600, deductionCents: 0 },
        { upToCents: reais(360_000), nominalRateBp: 1120, deductionCents: reais(9_360) },
        { upToCents: reais(720_000), nominalRateBp: 1350, deductionCents: reais(17_640) },
        { upToCents: reais(1_800_000), nominalRateBp: 1600, deductionCents: reais(35_640) },
        { upToCents: reais(3_600_000), nominalRateBp: 2100, deductionCents: reais(125_640) },
        { upToCents: reais(4_800_000), nominalRateBp: 3300, deductionCents: reais(648_000) },
      ],
      V: [
        { upToCents: reais(180_000), nominalRateBp: 1550, deductionCents: 0 },
        { upToCents: reais(360_000), nominalRateBp: 1800, deductionCents: reais(4_500) },
        { upToCents: reais(720_000), nominalRateBp: 1950, deductionCents: reais(9_900) },
        { upToCents: reais(1_800_000), nominalRateBp: 2050, deductionCents: reais(17_100) },
        { upToCents: reais(3_600_000), nominalRateBp: 2300, deductionCents: reais(62_100) },
        { upToCents: reais(4_800_000), nominalRateBp: 3050, deductionCents: reais(540_000) },
      ],
    },
  },
];

export class SimplesSimulationError extends Error {}

export function tableAt(date: string, tables: readonly SimplesTableVersion[] = SIMPLES_TABLES): SimplesTableVersion {
  const candidates = tables.filter((t) => t.validFrom <= date);
  if (candidates.length === 0) throw new SimplesSimulationError(`Sem tabela do Simples vigente em ${date}`);
  return candidates.reduce((a, b) => (b.validFrom > a.validFrom ? b : a));
}

function bracketFor(rbt12Cents: number, anexo: AnexoSimulado, date: string): SimplesBracket {
  if (rbt12Cents > SIMPLES_LIMIT_CENTS) {
    throw new SimplesSimulationError('RBT12 acima de R$ 4,8 mi: fora do Simples Nacional');
  }
  const brackets = tableAt(date).anexos[anexo];
  return brackets.find((b) => rbt12Cents <= b.upToCents)!;
}

// Divisão inteira com arredondamento meio-para-cima (valores não negativos).
function divRound(numerator: bigint, denominator: bigint): bigint {
  return (numerator * 2n + denominator) / (denominator * 2n);
}

/**
 * Alíquota efetiva = (RBT12 × nominal − dedução) / RBT12, em ppm. Com RBT12
 * zero (primeiro mês sem receita) vale a nominal da 1ª faixa.
 */
export function effectiveRate(rbt12Cents: number, anexo: AnexoSimulado, date = todayInSaoPaulo()): number {
  const { nominalRateBp, deductionCents } = bracketFor(rbt12Cents, anexo, date);
  if (rbt12Cents <= 0) return nominalRateBp * 100;
  const rbt = BigInt(rbt12Cents);
  return Number(divRound(rbt * BigInt(nominalRateBp) * 100n - BigInt(deductionCents) * 1_000_000n, rbt));
}

/** DAS do mês = receita do mês × alíquota efetiva, calculado sem arredondar a alíquota antes. */
export function dasCents(faturamentoMensalCents: number, rbt12Cents: number, anexo: AnexoSimulado, date = todayInSaoPaulo()): number {
  const { nominalRateBp, deductionCents } = bracketFor(rbt12Cents, anexo, date);
  const fat = BigInt(faturamentoMensalCents);
  if (rbt12Cents <= 0) return Number(divRound(fat * BigInt(nominalRateBp), 10_000n));
  const rbt = BigInt(rbt12Cents);
  const numerator = fat * (rbt * BigInt(nominalRateBp) - BigInt(deductionCents) * 10_000n);
  return Number(divRound(numerator, rbt * 10_000n));
}

/** Fator R em bp (truncado: 27,99% nunca vira 28%). */
export function fatorR(folha12Cents: number, rbt12Cents: number): number {
  if (rbt12Cents <= 0) return 0;
  return Number((BigInt(folha12Cents) * 10_000n) / BigInt(rbt12Cents));
}

export function anexoAplicavel(fatorRBp: number): AnexoSimulado {
  return fatorRBp >= FATOR_R_THRESHOLD_BP ? 'III' : 'V';
}

export interface SimulationInput {
  faturamentoMensalCents: number;
  /** Folha mensal atual (pró-labore + salários). */
  folhaMensalCents: number;
  /** Alíquota do INSS do sócio sobre o pró-labore, em bp (11% = 1100). */
  inssSocioRateBp: number;
  /** RBT12 real; se omitido, assume faturamento estável (12 × mensal). */
  rbt12Cents?: number;
  /** Folha dos 12 meses; se omitida, 12 × mensal. */
  folha12Cents?: number;
  date?: string;
}

export interface ScenarioCost {
  anexo: AnexoSimulado;
  folhaMensalCents: number;
  dasCents: number;
  inssSocioCents: number;
  custoTotalCents: number;
}

export interface SimulationResult {
  tableValidFrom: string;
  faturamentoMensalCents: number;
  rbt12Cents: number;
  fatorRBp: number;
  anexoIII: { aliquotaEfetivaPpm: number; dasCents: number };
  anexoV: { aliquotaEfetivaPpm: number; dasCents: number };
  /** Folha mensal mínima para Fator R >= 28% (faturamento estável). */
  proLaboreMinimoCents: number;
  /** Situação com a folha informada. */
  atual: ScenarioCost;
  /** Com a folha elevada ao mínimo do Fator R (Anexo III). */
  comFatorR: ScenarioCost;
  /** atual − comFatorR; positivo = vale subir o pró-labore. */
  economiaMensalCents: number;
}

function assertNonNegativeInt(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new SimplesSimulationError(`${name} deve ser inteiro não negativo`);
}

export function simulate(input: SimulationInput): SimulationResult {
  const date = input.date ?? todayInSaoPaulo();
  const { faturamentoMensalCents, folhaMensalCents, inssSocioRateBp } = input;
  assertNonNegativeInt('faturamentoMensalCents', faturamentoMensalCents);
  assertNonNegativeInt('folhaMensalCents', folhaMensalCents);
  assertNonNegativeInt('inssSocioRateBp', inssSocioRateBp);
  if (inssSocioRateBp > 10_000) throw new SimplesSimulationError('inssSocioRateBp acima de 100%');

  const rbt12Cents = input.rbt12Cents ?? faturamentoMensalCents * 12;
  const folha12Cents = input.folha12Cents ?? folhaMensalCents * 12;
  assertNonNegativeInt('rbt12Cents', rbt12Cents);
  assertNonNegativeInt('folha12Cents', folha12Cents);

  const das = { III: dasCents(faturamentoMensalCents, rbt12Cents, 'III', date), V: dasCents(faturamentoMensalCents, rbt12Cents, 'V', date) };
  const inss = (folha: number) => Number(divRound(BigInt(folha) * BigInt(inssSocioRateBp), 10_000n));
  const cost = (anexo: AnexoSimulado, folha: number): ScenarioCost => {
    const inssSocioCents = inss(folha);
    return { anexo, folhaMensalCents: folha, dasCents: das[anexo], inssSocioCents, custoTotalCents: das[anexo] + inssSocioCents };
  };

  const fatorRBp = fatorR(folha12Cents, rbt12Cents);
  // Menor folha mensal com folha12/RBT12 >= 28%, por mês (arredonda para cima).
  const proLaboreMinimoCents = Number(
    (BigInt(rbt12Cents) * BigInt(FATOR_R_THRESHOLD_BP) + 12n * 10_000n - 1n) / (12n * 10_000n),
  );

  const atual = cost(anexoAplicavel(fatorRBp), folhaMensalCents);
  const comFatorR = cost('III', Math.max(folhaMensalCents, proLaboreMinimoCents));

  return {
    tableValidFrom: tableAt(date).validFrom,
    faturamentoMensalCents,
    rbt12Cents,
    fatorRBp,
    anexoIII: { aliquotaEfetivaPpm: effectiveRate(rbt12Cents, 'III', date), dasCents: das.III },
    anexoV: { aliquotaEfetivaPpm: effectiveRate(rbt12Cents, 'V', date), dasCents: das.V },
    proLaboreMinimoCents,
    atual,
    comFatorR,
    economiaMensalCents: atual.custoTotalCents - comFatorR.custoTotalCents,
  };
}
