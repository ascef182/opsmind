'use client';

import { Card } from '@/components/ui/card';
import { DeltaBadge, deltaOf } from '@/components/dashboard/delta-badge';
import { formatCurrency } from '@/lib/deals/types';
import type { KpiValue, MoneyByCurrency, RevenuePeriod } from '@/lib/revenue/types';
import { cn } from '@/lib/utils';

export const PERIOD_OPTIONS: Array<{ value: RevenuePeriod; label: string; comparison: string }> = [
  { value: 'day', label: 'Hoje', comparison: 'últimas 24h vs. 24h anteriores' },
  { value: 'week', label: '7 dias', comparison: 'últimos 7 dias vs. 7 anteriores' },
  { value: 'month', label: '30 dias', comparison: 'últimos 30 dias vs. 30 anteriores' },
];

export function PeriodToggle({ value, onChange }: { value: RevenuePeriod; onChange: (value: RevenuePeriod) => void }) {
  return (
    <div role="radiogroup" aria-label="Período" className="inline-flex rounded-md border border-border p-0.5">
      {PERIOD_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'rounded px-3 py-1 text-sm transition-colors',
            value === option.value ? 'bg-ink-700 text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function formatUsd(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: value > 0 && value < 1 ? 4 : 2,
  }).format(value);
}

// Moedas nunca são somadas entre si: cada uma vira uma linha.
export function formatMoneyByCurrency(money: MoneyByCurrency): string {
  const entries = Object.entries(money).filter(([, amount]) => amount !== 0);
  if (entries.length === 0) return '—';
  return entries.map(([currency, amount]) => formatCurrency(amount, currency)).join(' · ');
}

export function KpiTile({
  label,
  kpi,
  format = (value) => value.toLocaleString('pt-BR'),
  invert = false,
  emphasis = false,
}: {
  label: string;
  kpi: KpiValue;
  format?: (value: number) => string;
  invert?: boolean;
  emphasis?: boolean;
}) {
  const pending = kpi.availableFromPhase !== undefined;
  return (
    <Card className={cn('flex flex-col gap-1 p-4', emphasis && 'border-accent-500/40')}>
      <span className="text-xs text-muted-foreground">{label}</span>
      {pending ? (
        <>
          <span className="text-xl font-semibold tabular-nums text-muted-foreground">—</span>
          <span className="text-xs text-muted-foreground">Disponível a partir da fase {kpi.availableFromPhase}</span>
        </>
      ) : (
        <div className="flex items-end justify-between gap-2">
          <span className={cn('font-semibold tabular-nums', emphasis ? 'text-3xl' : 'text-xl')}>
            {format(kpi.current)}
          </span>
          <DeltaBadge delta={deltaOf(kpi.current, kpi.previous)} colorCoded invert={invert} format={format} />
        </div>
      )}
    </Card>
  );
}

export function formatHours(hours: number | null): string {
  if (hours === null) return '—';
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  if (hours < 48) return `${Math.round(hours)} h`;
  return `${Math.round(hours / 24)} d`;
}

export function formatRate(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`;
}
