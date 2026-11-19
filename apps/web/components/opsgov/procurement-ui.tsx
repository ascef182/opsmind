import { PROCUREMENT_STATUS_LABELS, type ProcurementStatus, type ReadinessSummary } from '@/lib/opsgov/types';
import { cn } from '@/lib/utils';

const STATUS_CLASS: Record<ProcurementStatus, string> = {
  RADAR: 'bg-ink-800 text-muted-foreground',
  ANALISE: 'bg-ink-800 text-foreground',
  PROPOSTA: 'bg-accent-500/15 text-accent-500',
  DISPUTA: 'bg-accent-500/15 text-accent-500',
  GANHA: 'bg-positive-500/15 text-positive-500',
  PERDIDA: 'bg-negative-500/15 text-negative-500',
  DESCARTADA: 'bg-ink-800 text-muted-foreground line-through',
};

export function ProcurementStatusPill({ status }: { status: ProcurementStatus }) {
  return <span className={cn('rounded px-1.5 py-0.5 text-xs', STATUS_CLASS[status])}>{PROCUREMENT_STATUS_LABELS[status]}</span>;
}

/** Barra de prontidão: verde só quando não há bloqueador, não só pelo percentual. */
export function ReadinessBar({ readiness, className }: { readiness: Pick<ReadinessSummary, 'score' | 'ready' | 'total'>; className?: string }) {
  const tone = readiness.ready ? 'bg-positive-500' : readiness.score >= 50 ? 'bg-accent-500' : 'bg-negative-500';
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div
        className="h-1.5 w-24 overflow-hidden rounded-full bg-ink-800"
        role="progressbar"
        aria-valuenow={readiness.score}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Prontidão"
      >
        <div className={cn('h-full rounded-full', tone)} style={{ width: `${readiness.score}%` }} />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">
        {readiness.total === 0 ? 'sem checklist' : `${readiness.score}%`}
      </span>
    </div>
  );
}

export function labelOptions<T extends string>(labels: Record<T, string>) {
  return (Object.keys(labels) as T[]).map((key) => (
    <option key={key} value={key}>
      {labels[key]}
    </option>
  ));
}
