import clsx from 'clsx';

const COLORS: Record<string, string> = {
  LEAD: 'bg-amber-100 text-amber-800',
  ACTIVE: 'bg-green-100 text-green-800',
  INACTIVE: 'bg-slate-200 text-slate-600',
  OPEN: 'bg-blue-100 text-blue-800',
  IN_PROGRESS: 'bg-amber-100 text-amber-800',
  DONE: 'bg-green-100 text-green-800',
  CANCELLED: 'bg-slate-200 text-slate-500 line-through',
  PROCESSING: 'bg-amber-100 text-amber-800',
  READY: 'bg-green-100 text-green-800',
  FAILED: 'bg-red-100 text-red-800',
};

export function Badge({ value }: { value: string }) {
  return (
    <span
      className={clsx(
        'inline-block rounded-full px-2 py-0.5 text-xs font-medium',
        COLORS[value] ?? 'bg-slate-100 text-slate-600',
      )}
    >
      {value}
    </span>
  );
}
