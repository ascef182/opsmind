// Enums do OpsGov espelhados do schema Prisma — a web duplica os seus em
// apps/web/lib/opsgov/types.ts (padrão do projeto).

export const NATUREZAS_JURIDICAS = ['MEI', 'EI', 'SLU', 'LTDA'] as const;
export type NaturezaJuridica = (typeof NATUREZAS_JURIDICAS)[number];

export const TAX_REGIMES = ['SIMEI', 'SIMPLES_NACIONAL', 'LUCRO_PRESUMIDO', 'LUCRO_REAL'] as const;
export type TaxRegime = (typeof TAX_REGIMES)[number];

export const IBS_CBS_MODES = ['DENTRO_DAS', 'REGULAR', 'NAO_SE_APLICA'] as const;
export type IbsCbsMode = (typeof IBS_CBS_MODES)[number];

export const ANEXOS_SIMPLES = ['I', 'II', 'III', 'IV', 'V', 'FATOR_R', 'NAO_DEFINIDO'] as const;
export type AnexoSimples = (typeof ANEXOS_SIMPLES)[number];

export const REVENUE_GROUPS = ['TECNOLOGIA', 'TRADUCAO_LEGENDAGEM', 'OUTROS'] as const;
export type RevenueGroup = (typeof REVENUE_GROUPS)[number];

// CNAE no formato da Receita: 0000-0/00.
const CNAE_PATTERN = /^\d{4}-\d\/\d{2}$/;

export function normalizeCnae(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  if (digits.length !== 7) return null;
  const formatted = `${digits.slice(0, 4)}-${digits.slice(4, 5)}/${digits.slice(5)}`;
  return CNAE_PATTERN.test(formatted) ? formatted : null;
}

export function normalizeCnpj(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  if (digits.length !== 14 || /^(\d)\1{13}$/.test(digits)) return null;
  const checkDigit = (base: string, weights: number[]) => {
    const sum = weights.reduce((acc, w, i) => acc + w * Number(base[i]), 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  const d1 = checkDigit(digits, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = checkDigit(digits, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return d1 === Number(digits[12]) && d2 === Number(digits[13]) ? digits : null;
}
