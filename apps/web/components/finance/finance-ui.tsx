import Link from 'next/link';
import type { DisplayStatus } from '@opsmind/shared-types';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { STATUS_CLASS, STATUS_LABEL } from '@/lib/finance/format';

export function StatusPill({ status }: { status: DisplayStatus }) {
  return (
    <span className={cn('inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', STATUS_CLASS[status])}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function Kpi({
  label,
  value,
  hint,
  tone = 'default',
  chart,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'positive' | 'negative';
  // Mini-tendência opcional dentro do tile (ex.: <SparklineChart />) — mesmo
  // padrão do KpiCard do dashboard principal, sem precisar de outro componente.
  chart?: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-1 p-4">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        className={cn(
          'text-xl font-semibold tabular-nums',
          tone === 'positive' && 'text-positive-500',
          tone === 'negative' && 'text-negative-500',
        )}
      >
        {value}
      </span>
      {chart && <div className="mt-1">{chart}</div>}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </Card>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: { label: string; href: string };
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-6 py-10 text-center">
      <p className="font-medium text-foreground">{title}</p>
      <p className="max-w-md text-sm text-muted-foreground">{description}</p>
      {action && (
        <Link href={action.href} className="text-sm text-accent-500 hover:underline">
          {action.label}
        </Link>
      )}
    </div>
  );
}

/** Rótulo + controle, para formulários dos diálogos. */
export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}
