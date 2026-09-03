import clsx from 'clsx';

const COLORS: Record<string, string> = {
  LEAD: 'bg-amber-100 text-amber-800',
  ACTIVE: 'bg-green-100 text-green-800',
  INACTIVE: 'bg-slate-200 text-slate-600',
  OPEN: 'bg-blue-100 text-blue-800',
  IN_PROGRESS: 'bg-amber-100 text-amber-800',
  DONE: 'bg-green-100 text-green-800',
  CANCELLED: 'bg-slate-200 text-slate-500 line-through',

  // LeadStatus (packages/database/prisma/schema.prisma)
  DISCOVERED: 'bg-slate-100 text-slate-600',
  QUALIFIED: 'bg-green-100 text-green-800',
  DISQUALIFIED: 'bg-red-100 text-red-700',
  OUTREACH_DRAFTED: 'bg-amber-100 text-amber-800',
  OUTREACH_APPROVED: 'bg-blue-100 text-blue-800',
  CONTACTED: 'bg-indigo-100 text-indigo-800',
  // REPLIED também é um valor de OutreachStatus — mesma cor serve pros dois
  // já que COLORS é string-keyed.
  REPLIED: 'bg-purple-100 text-purple-800',
  CONVERTED: 'bg-emerald-100 text-emerald-800',
  LOST: 'bg-slate-200 text-slate-500 line-through',

  // OutreachStatus (packages/database/prisma/schema.prisma)
  DRAFT: 'bg-amber-50 text-amber-700',
  APPROVED: 'bg-blue-100 text-blue-800',
  REJECTED: 'bg-red-100 text-red-700',
  SENT: 'bg-cyan-100 text-cyan-800',
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
