import { addMonths, monthsBetween } from './finance';

// RBT12 = receita bruta acumulada nos 12 meses anteriores ao período de
// apuração (LC 123/2006, art. 18, §1º). No início de atividade (Res. CGSN
// 140/2018, art. 22), antes de completar 12 meses:
//   - no mês de início: receita do próprio mês × 12;
//   - nos 11 meses seguintes: média dos meses anteriores × 12.
// Receita do período como MEI entra no RBT12 da ME: é a mesma empresa.

export type Rbt12Method = 'TWELVE_MONTHS' | 'START_MONTH' | 'START_AVERAGE';

export interface Rbt12Result {
  month: string;
  rbt12Cents: number;
  method: Rbt12Method;
  monthsConsidered: string[];
}

/**
 * @param revenueByMonth receita por mês 'YYYY-MM' (mês ausente = zero)
 * @param month mês de apuração 'YYYY-MM'
 * @param activityStartMonth mês de início de atividade; null = mais de 12 meses
 */
export function computeRbt12(
  revenueByMonth: Readonly<Record<string, number>>,
  month: string,
  activityStartMonth: string | null,
): Rbt12Result {
  const revenue = (m: string) => revenueByMonth[m] ?? 0;
  const previous12 = monthsBetween(addMonths(month, -12), addMonths(month, -1));

  if (activityStartMonth === null || activityStartMonth <= previous12[0]!) {
    return {
      month,
      rbt12Cents: previous12.reduce((total, m) => total + revenue(m), 0),
      method: 'TWELVE_MONTHS',
      monthsConsidered: previous12,
    };
  }

  if (activityStartMonth >= month) {
    return { month, rbt12Cents: revenue(month) * 12, method: 'START_MONTH', monthsConsidered: [month] };
  }

  const before = monthsBetween(activityStartMonth, addMonths(month, -1));
  const total = before.reduce((acc, m) => acc + revenue(m), 0);
  return {
    month,
    rbt12Cents: Math.round((total * 12) / before.length),
    method: 'START_AVERAGE',
    monthsConsidered: before,
  };
}
