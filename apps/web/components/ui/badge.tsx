import { cn } from '@/lib/utils';

const COLORS: Record<string, string> = {
  LEAD: 'bg-accent-500/15 text-accent-500',
  ACTIVE: 'bg-positive-500/15 text-positive-500',
  INACTIVE: 'bg-ink-800 text-ink-300',
  OPEN: 'bg-info-500/15 text-info-500',
  IN_PROGRESS: 'bg-accent-500/15 text-accent-500',
  DONE: 'bg-positive-500/15 text-positive-500',
  CANCELLED: 'bg-ink-800 text-ink-300 line-through',

  // LeadStatus (packages/database/prisma/schema.prisma)
  DISCOVERED: 'bg-ink-800 text-ink-300',
  QUALIFIED: 'bg-positive-500/15 text-positive-500',
  DISQUALIFIED: 'bg-negative-500/15 text-negative-500',
  OUTREACH_DRAFTED: 'bg-accent-500/15 text-accent-500',
  OUTREACH_APPROVED: 'bg-info-500/15 text-info-500',
  CONTACTED: 'bg-info-500/15 text-info-500',
  // REPLIED também é um valor de OutreachStatus — mesma cor serve pros dois
  // já que COLORS é string-keyed.
  REPLIED: 'bg-info-500/15 text-info-500',
  CONVERTED: 'bg-positive-500/15 text-positive-500',
  LOST: 'bg-ink-800 text-ink-300 line-through',

  // OutreachStatus (packages/database/prisma/schema.prisma)
  DRAFT: 'bg-accent-500/15 text-accent-500',
  APPROVED: 'bg-info-500/15 text-info-500',
  REJECTED: 'bg-negative-500/15 text-negative-500',
  SENT: 'bg-info-500/15 text-info-500',

  // ScrapeJobStatus (packages/database/prisma/schema.prisma)
  QUEUED: 'bg-ink-800 text-ink-300',
  RUNNING: 'bg-info-500/15 text-info-500',
  COMPLETED: 'bg-positive-500/15 text-positive-500',
  FAILED: 'bg-negative-500/15 text-negative-500',

  // MarketOpportunityStatus (packages/database/prisma/schema.prisma)
  NEW: 'bg-accent-500/15 text-accent-500',
  REVIEWING: 'bg-info-500/15 text-info-500',
  PURSUING: 'bg-positive-500/15 text-positive-500',
  DISMISSED: 'bg-ink-800 text-ink-300 line-through',

  // DealStage (packages/database/prisma/schema.prisma) — QUALIFICATION reusa
  // a cor de DISCOVERED/QUEUED (mesmo espírito: primeiro estágio, neutro).
  // WON reusa a cor de CONVERTED/DONE (positivo/fechado). LOST já está
  // mapeado acima (compartilhado com LeadStatus).
  QUALIFICATION: 'bg-ink-800 text-ink-300',
  PROPOSAL: 'bg-accent-500/15 text-accent-500',
  NEGOTIATION: 'bg-info-500/15 text-info-500',
  CONTRACT_SENT: 'bg-info-500/15 text-info-500',
  WON: 'bg-positive-500/15 text-positive-500',

  // SignatureRequestStatus (packages/database/prisma/schema.prisma) — SENT
  // já mapeado acima (compartilhado com OutreachStatus).
  SIGNED: 'bg-positive-500/15 text-positive-500',
  DECLINED: 'bg-negative-500/15 text-negative-500',
  CANCELED: 'bg-ink-800 text-ink-300 line-through',

  // Role (packages/shared-types — ROLE_HIERARCHY), usado na página de Equipe
  OWNER: 'bg-accent-500/15 text-accent-500',
  ADMIN: 'bg-info-500/15 text-info-500',
  MANAGER: 'bg-positive-500/15 text-positive-500',
  MEMBER: 'bg-ink-800 text-ink-300',
  VIEWER: 'bg-ink-800 text-ink-300',
};

export function Badge({ value }: { value: string }) {
  return (
    <span
      className={cn(
        'inline-block rounded-full px-2 py-0.5 text-xs font-medium',
        COLORS[value] ?? 'bg-ink-800 text-ink-300',
      )}
    >
      {value}
    </span>
  );
}
