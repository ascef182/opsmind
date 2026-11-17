'use client';

import { useState } from 'react';
import { Loader2, Pause, Play, RotateCcw, Square } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, FormError } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useHarveyCommand } from '@/lib/harvey/use-harvey';
import {
  COMMANDS_BY_STATE,
  STATUS_LABELS,
  formatDuration,
  type HarveyCommand,
  type HarveyDisplayStatus,
  type HarveySnapshot,
} from '@/lib/harvey/types';
import type { ApiError } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { relativeTime } from './relative-time';

const TONE: Record<HarveyDisplayStatus, string> = {
  IDLE: 'bg-ink-500',
  RUNNING: 'bg-positive-500',
  RESEARCHING: 'bg-positive-500',
  QUALIFYING: 'bg-positive-500',
  PREPARING_OUTREACH: 'bg-positive-500',
  AWAITING_APPROVAL: 'bg-accent-500',
  SENDING: 'bg-info-500',
  RESPONDING: 'bg-info-500',
  PAUSED: 'bg-accent-500',
  STOPPED: 'bg-ink-500',
  ERROR: 'bg-negative-500',
  COMPLETED: 'bg-info-500',
};

const BUSY = new Set<HarveyDisplayStatus>(['RUNNING', 'RESEARCHING', 'QUALIFYING', 'PREPARING_OUTREACH', 'SENDING', 'RESPONDING']);

const COMMAND_BUTTONS: Record<HarveyCommand, { label: string; icon: typeof Play; variant: 'primary' | 'secondary' }> = {
  START: { label: 'Iniciar', icon: Play, variant: 'primary' },
  RESUME: { label: 'Retomar', icon: RotateCcw, variant: 'primary' },
  PAUSE: { label: 'Pausar', icon: Pause, variant: 'secondary' },
  STOP: { label: 'Parar', icon: Square, variant: 'secondary' },
};

const COMMAND_DONE: Record<HarveyCommand, string> = {
  START: 'Harvey iniciado',
  RESUME: 'Harvey retomado',
  PAUSE: 'Harvey pausado: nenhuma tarefa nova começa',
  STOP: 'Harvey parado',
};

export function HarveyStatusHeader({
  organizationId,
  snapshot,
  canControl,
  connected,
}: {
  organizationId: string;
  snapshot: HarveySnapshot;
  canControl: boolean;
  connected: boolean;
}) {
  const command = useHarveyCommand(organizationId);
  const [confirmStop, setConfirmStop] = useState(false);
  const run = (cmd: HarveyCommand) =>
    command.mutate({ command: cmd }, { onSuccess: () => toast.success(COMMAND_DONE[cmd]) });

  const runningMs = snapshot.runs.reduce((total, item) => total + item.runningMs, 0);
  const pausedMs = snapshot.runs.reduce((total, item) => total + item.pausedMs, 0);

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="relative flex size-2.5" aria-hidden>
              {BUSY.has(snapshot.status) && (
                <span className={cn('absolute inline-flex size-full animate-ping rounded-full opacity-60', TONE[snapshot.status])} />
              )}
              <span className={cn('relative inline-flex size-2.5 rounded-full', TONE[snapshot.status])} />
            </span>
            <h2 className="text-lg font-semibold" aria-live="polite">
              {STATUS_LABELS[snapshot.status]}
            </h2>
          </div>
          <p className="text-sm text-muted-foreground">
            {runningMs > 0 && `${formatDuration(runningMs)} em execução hoje`}
            {pausedMs > 0 && ` · ${formatDuration(pausedMs)} pausado`}
            {snapshot.status === 'IDLE' && snapshot.controlState === 'ACTIVE' && snapshot.nextWorkStart &&
              `Fora do horário. Próximo início ${relativeTime(snapshot.nextWorkStart)}.`}
            {snapshot.status === 'IDLE' && snapshot.controlState === 'STOPPED' && 'Pronto para começar.'}
          </p>
          {snapshot.status === 'ERROR' && snapshot.lastError && (
            <p className="text-sm text-negative-500">{snapshot.lastError}</p>
          )}
          {!connected && (
            <p className="text-xs text-muted-foreground">Reconectando ao tempo real…</p>
          )}
        </div>

        {canControl && (
          <div className="flex flex-wrap gap-2">
            {COMMANDS_BY_STATE[snapshot.controlState].map((cmd) => {
              const { label, icon: Icon, variant } = COMMAND_BUTTONS[cmd];
              return (
                <Button
                  key={cmd}
                  variant={variant}
                  size="sm"
                  disabled={command.isPending}
                  onClick={() => (cmd === 'STOP' ? setConfirmStop(true) : run(cmd))}
                >
                  {command.isPending && command.variables?.command === cmd ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <Icon className="size-4" aria-hidden />
                  )}
                  {label}
                </Button>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Fazendo agora</p>
        {snapshot.inProgress.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma tarefa em andamento.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {snapshot.inProgress.map((activity) => (
              <li key={activity.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <Loader2 className="size-3.5 shrink-0 animate-spin text-info-500" aria-hidden />
                  <span className="truncate">{activity.title}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{relativeTime(activity.startedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <FormError message={command.isError ? (command.error as ApiError).message : null} />

      <AlertDialog open={confirmStop} onOpenChange={setConfirmStop}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Parar o Harvey?</AlertDialogTitle>
            <AlertDialogDescription>
              O ciclo de hoje é encerrado e nenhuma tarefa nova começa. Diferente de pausar, o Harvey não volta sozinho
              amanhã: será preciso iniciar de novo. O histórico e os leads ficam como estão, e você continua podendo
              trabalhar manualmente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => run('STOP')}>Parar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
