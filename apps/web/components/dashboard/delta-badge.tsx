import clsx from 'clsx';

export interface Delta {
  diff: number;
  pct: number | null;
}

export function deltaOf(current: number, previous: number): Delta {
  return { diff: current - previous, pct: previous === 0 ? null : (current - previous) / previous };
}

// `invert`: para métricas em que subir é ruim (gasto, custo por lead).
export function DeltaBadge({
  delta,
  colorCoded = false,
  invert = false,
  format = (value: number) => String(value),
}: {
  delta: Delta;
  colorCoded?: boolean;
  invert?: boolean;
  format?: (value: number) => string;
}) {
  const arrow = delta.diff > 0 ? '▲' : delta.diff < 0 ? '▼' : '→';
  const diffLabel = `${delta.diff > 0 ? '+' : delta.diff < 0 ? '−' : ''}${format(Math.abs(delta.diff))}`;
  const pctLabel = delta.pct === null ? '' : ` (${delta.pct >= 0 ? '+' : ''}${Math.round(delta.pct * 100)}%)`;
  const good = invert ? delta.diff < 0 : delta.diff > 0;
  const bad = invert ? delta.diff > 0 : delta.diff < 0;
  const colorClass =
    colorCoded && good
      ? 'bg-positive-500/10 text-positive-500'
      : colorCoded && bad
        ? 'bg-negative-500/10 text-negative-500'
        : 'bg-muted text-muted-foreground';
  return (
    <span
      className={clsx(
        'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium',
        colorClass,
      )}
    >
      {arrow} {diffLabel}
      {pctLabel}
    </span>
  );
}
