'use client';

import Link from 'next/link';
import { Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { END_REASON_LABELS, minutesToTime, type HarveySnapshot } from '@/lib/harvey/types';

function Goal({ label, value, goal }: { label: string; value: number; goal: number }) {
  const percent = goal > 0 ? Math.min(100, Math.round((value / goal) * 100)) : 0;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums">
          <span className="font-semibold">{value}</span>
          <span className="text-muted-foreground">/{goal}</span>
        </span>
      </div>
      <Progress value={percent} aria-label={`${label}: ${value} de ${goal}`} />
    </div>
  );
}

export function HarveyGoals({
  organizationId,
  snapshot,
  canConfigure,
  onConfigure,
}: {
  organizationId: string;
  snapshot: HarveySnapshot;
  canConfigure: boolean;
  onConfigure: (campaignId: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {snapshot.runs.map((run) => (
        <Card key={run.campaignId} className="flex flex-col gap-4 p-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="font-medium">Hoje · {run.campaignName}</h3>
              <p className="text-xs text-muted-foreground">
                {run.country} · {minutesToTime(run.workStartMinute)}–{minutesToTime(run.workEndMinute)} ({run.timezone})
                {run.status === 'COMPLETED' && run.endReason && ` · ciclo concluído: ${END_REASON_LABELS[run.endReason] ?? run.endReason}`}
                {run.status === 'STOPPED' && ' · ciclo encerrado'}
                {run.status === null && ' · ciclo ainda não começou'}
              </p>
            </div>
            {canConfigure && (
              <Button variant="ghost" size="sm" onClick={() => onConfigure(run.campaignId)}>
                <Settings2 className="size-4" aria-hidden />
                Metas e horário
              </Button>
            )}
          </div>
          {run.activeTargets === 0 && (
            <p className="rounded-md border border-accent-500/40 bg-accent-500/5 px-3 py-2 text-sm">
              Esta campanha não tem alvos de prospecção ativos, então o Harvey não tem onde pesquisar.{' '}
              <Link href={`/organizations/${organizationId}/prospecting-targets`} className="text-accent-500 hover:underline">
                Cadastrar alvos
              </Link>
            </p>
          )}
          <div className="flex flex-col gap-4">
            <Goal label="Empresas pesquisadas" value={run.progress.researched} goal={run.goals.research} />
            <Goal label="Leads qualificados" value={run.progress.qualified} goal={run.goals.qualified} />
            <Goal label="Abordagens preparadas" value={run.progress.prepared} goal={run.goals.outreach} />
          </div>
          <p className="text-xs text-muted-foreground">Metas são limites de trabalho do dia, não promessa de resultado.</p>
        </Card>
      ))}
      <Card className="flex items-center justify-between gap-3 p-4">
        <p className="text-sm">
          <span className="font-semibold tabular-nums">{snapshot.pendingApprovals}</span>{' '}
          {snapshot.pendingApprovals === 1 ? 'abordagem aguardando' : 'abordagens aguardando'} sua aprovação
        </p>
        <Link
          href={`/organizations/${organizationId}/outreach`}
          className="text-sm text-accent-500 hover:underline"
        >
          Revisar
        </Link>
      </Card>
    </div>
  );
}
