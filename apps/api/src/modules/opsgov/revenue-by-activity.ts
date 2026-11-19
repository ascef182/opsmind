// Agrupamento puro da receita por atividade. As contas de período são as do
// financeiro (`monthlySeries`), aplicadas a cada fatia de lançamentos — aqui só
// se decide a fatia. Competência = faturado por data de emissão (sem PLANNED
// nem CANCELLED); caixa = recebido por data de pagamento.

import { monthsBetween, type RevenueGroup } from '@opsmind/shared-types';
import { monthlySeries } from '../finance/finance-aggregation';
import type { BusinessIncomeDataset } from '../finance/finance-reports.service';

export type RevenueBasis = 'COMPETENCIA' | 'CAIXA';

export interface ActivityVersion {
  id: string;
  cnae: string;
  description: string;
  revenueGroup: RevenueGroup;
  validFrom: string;
}

export interface RevenueLine {
  monthsCents: number[];
  totalCents: number;
}

export interface RevenueByActivity {
  basis: RevenueBasis;
  months: string[];
  rows: Array<RevenueLine & { cnae: string; description: string; revenueGroup: RevenueGroup }>;
  groups: Array<RevenueLine & { revenueGroup: RevenueGroup }>;
  unclassified: RevenueLine;
  totals: RevenueLine;
}

const GROUP_ORDER: RevenueGroup[] = ['TECNOLOGIA', 'TRADUCAO_LEGENDAGEM', 'OUTROS'];

function line(
  data: BusinessIncomeDataset,
  keep: (activityId: string | null) => boolean,
  fromMonth: string,
  toMonth: string,
  basis: RevenueBasis,
): RevenueLine {
  const slice = {
    entries: data.entries.filter((e) => keep(e.companyActivityId)),
    payments: data.payments.filter((p) => keep(p.companyActivityId)),
    contracts: [],
  };
  const monthsCents = monthlySeries(slice, fromMonth, toMonth).map((point) =>
    basis === 'COMPETENCIA' ? point.invoicedCents : point.receivedCents,
  );
  return { monthsCents, totalCents: monthsCents.reduce((a, b) => a + b, 0) };
}

export function revenueByActivity(
  data: BusinessIncomeDataset,
  versions: ActivityVersion[],
  fromMonth: string,
  toMonth: string,
  basis: RevenueBasis,
): RevenueByActivity {
  const versionById = new Map(versions.map((v) => [v.id, v]));
  const byCnae = new Map<string, ActivityVersion[]>();
  for (const v of versions) byCnae.set(v.cnae, [...(byCnae.get(v.cnae) ?? []), v]);

  const rows = [...byCnae.entries()]
    .map(([cnae, cnaeVersions]) => {
      const ids = new Set(cnaeVersions.map((v) => v.id));
      const latest = cnaeVersions.reduce((a, b) => (b.validFrom > a.validFrom ? b : a));
      return {
        cnae,
        description: latest.description,
        revenueGroup: latest.revenueGroup,
        ...line(data, (id) => id !== null && ids.has(id), fromMonth, toMonth, basis),
      };
    })
    .filter((row) => row.totalCents > 0)
    .sort((a, b) => b.totalCents - a.totalCents || a.cnae.localeCompare(b.cnae));

  // O grupo vem da versão vinculada ao lançamento (o que valia na emissão).
  const groups = GROUP_ORDER.map((revenueGroup) => ({
    revenueGroup,
    ...line(data, (id) => id !== null && versionById.get(id)?.revenueGroup === revenueGroup, fromMonth, toMonth, basis),
  }));

  return {
    basis,
    months: monthsBetween(fromMonth, toMonth),
    rows,
    groups,
    unclassified: line(data, (id) => id === null || !versionById.has(id), fromMonth, toMonth, basis),
    totals: line(data, () => true, fromMonth, toMonth, basis),
  };
}

/** Receita total por mês (classificada ou não), na base pedida — entrada do RBT12. */
export function monthlyRevenue(
  data: BusinessIncomeDataset,
  fromMonth: string,
  toMonth: string,
  basis: RevenueBasis,
): Record<string, number> {
  const { monthsCents } = line(data, () => true, fromMonth, toMonth, basis);
  const months = monthsBetween(fromMonth, toMonth);
  return Object.fromEntries(months.map((m, i) => [m, monthsCents[i]!]));
}
