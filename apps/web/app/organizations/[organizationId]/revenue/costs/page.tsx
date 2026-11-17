'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { Card, FormError } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { LineChartWithTooltip } from '@/components/ui/chart-card';
import { PERIOD_OPTIONS, PeriodToggle, formatUsd } from '@/components/revenue/revenue-ui';
import { useRevenueCosts, useRevenueSettings } from '@/lib/revenue/use-revenue';
import { COST_CATEGORY_LABEL, type RevenueCosts, type RevenuePeriod } from '@/lib/revenue/types';
import type { ApiError } from '@/lib/api-client';

export default function RevenueCostsPage() {
  const { organizationId } = useParams<{ organizationId: string }>();
  const [period, setPeriod] = useState<RevenuePeriod>('month');
  const costs = useRevenueCosts(organizationId, period);
  const settings = useRevenueSettings(organizationId);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {PERIOD_OPTIONS.find((option) => option.value === period)!.label} · valores estimados em dólar
        </p>
        <PeriodToggle value={period} onChange={setPeriod} />
      </div>
      {costs.isLoading && <Skeleton className="h-80 w-full" />}
      {costs.isError && <FormError message={(costs.error as ApiError).message} />}
      {costs.data && <CostsContent data={costs.data} monthlyBudgetUsd={settings.data?.engineMonthlyBudgetUsd} />}
    </div>
  );
}

function CostsContent({ data, monthlyBudgetUsd }: { data: RevenueCosts; monthlyBudgetUsd?: number }) {
  const unit = [
    { label: 'Por negócio descoberto', value: data.unitCostsUsd.perDiscoveredLead },
    { label: 'Por lead qualificado', value: data.unitCostsUsd.perQualifiedLead },
    { label: 'Por resposta positiva', value: data.unitCostsUsd.perPositiveReply },
    { label: 'Por negócio ganho', value: data.unitCostsUsd.perWonDeal },
  ];
  const max = Math.max(0.000001, ...data.byCategory.map((row) => row.amountUsd));

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="flex flex-col gap-1 p-4">
          <span className="text-xs text-muted-foreground">Gasto no período</span>
          <span className="text-3xl font-semibold tabular-nums">{formatUsd(data.totalUsd)}</span>
          {data.period === 'month' && monthlyBudgetUsd !== undefined && (
            <span className="text-xs text-muted-foreground">teto mensal do engine: {formatUsd(monthlyBudgetUsd)}</span>
          )}
        </Card>
        {unit.slice(0, 3).map((item) => (
          <Card key={item.label} className="flex flex-col gap-1 p-4">
            <span className="text-xs text-muted-foreground">{item.label}</span>
            <span className="text-xl font-semibold tabular-nums">{item.value === null ? '—' : formatUsd(item.value)}</span>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="flex flex-col gap-3 p-4 lg:col-span-2">
          <h2 className="text-sm font-medium">Gasto diário, últimos 30 dias</h2>
          <LineChartWithTooltip
            data={data.daily.map((point) => ({
              date: `${point.date.slice(8, 10)}/${point.date.slice(5, 7)}`,
              amountUsd: Number(point.amountUsd.toFixed(4)),
            }))}
            dataKey="amountUsd"
            xKey="date"
            height={220}
          />
        </Card>
        <Card className="flex flex-col gap-3 p-4">
          <h2 className="text-sm font-medium">Por categoria</h2>
          {data.byCategory.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum gasto registrado no período.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {data.byCategory.map((row) => (
                <li key={row.category} className="flex flex-col gap-1">
                  <div className="flex justify-between text-sm">
                    <span>{COST_CATEGORY_LABEL[row.category]}</span>
                    <span className="tabular-nums">{formatUsd(row.amountUsd)}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-ink-800" aria-hidden>
                    <div className="h-1.5 rounded-full bg-accent-500" style={{ width: `${(row.amountUsd / max) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">
            Custo por negócio ganho: {unit[3]!.value === null ? '—' : formatUsd(unit[3]!.value)}
          </p>
        </Card>
      </div>
    </>
  );
}
