'use client';

import Link from 'next/link';
import { Bot } from 'lucide-react';
import { useHarveySnapshot } from '@/lib/harvey/use-harvey';
import { STATUS_LABELS } from '@/lib/harvey/types';

// Faixa compacta para a visão geral do Revenue Engine.
export function HarveyStatusStrip({ organizationId }: { organizationId: string }) {
  const snapshot = useHarveySnapshot(organizationId);
  if (!snapshot.data) return null;
  const today = snapshot.data.runs.reduce(
    (total, run) => ({
      researched: total.researched + run.progress.researched,
      qualified: total.qualified + run.progress.qualified,
    }),
    { researched: 0, qualified: 0 },
  );
  return (
    <Link
      href={`/organizations/${organizationId}/revenue/harvey`}
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4 hover:bg-ink-800"
    >
      <span className="flex items-center gap-2 text-sm">
        <Bot className="size-4 text-accent-500" aria-hidden />
        <span className="font-medium">Harvey: {STATUS_LABELS[snapshot.data.status]}</span>
      </span>
      <span className="text-xs text-muted-foreground">
        Hoje: {today.researched} pesquisados · {today.qualified} qualificados · {snapshot.data.pendingApprovals} aguardando
        aprovação
      </span>
    </Link>
  );
}
