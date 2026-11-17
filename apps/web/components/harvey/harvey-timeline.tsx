'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, ChevronDown, CircleSlash, Loader2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, FormError } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useHarveyActivities, type ActivityFilters } from '@/lib/harvey/use-harvey';
import {
  ACTIVITY_STATUS_LABELS,
  PHASE_LABELS,
  type HarveyActivity,
  type HarveyActivityStatus,
  type HarveyPhase,
} from '@/lib/harvey/types';
import type { ApiError } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { clockTime, relativeTime } from './relative-time';

const STATUS_ICON: Record<HarveyActivityStatus, { icon: typeof CheckCircle2; className: string }> = {
  STARTED: { icon: Loader2, className: 'animate-spin text-info-500' },
  SUCCEEDED: { icon: CheckCircle2, className: 'text-positive-500' },
  FAILED: { icon: XCircle, className: 'text-negative-500' },
  SKIPPED: { icon: CircleSlash, className: 'text-accent-500' },
  CANCELLED: { icon: CircleSlash, className: 'text-muted-foreground' },
};

function duration(activity: HarveyActivity): string | null {
  if (!activity.finishedAt) return null;
  const seconds = Math.round((new Date(activity.finishedAt).getTime() - new Date(activity.startedAt).getTime()) / 1000);
  if (seconds < 1) return null;
  return seconds < 60 ? `${seconds}s` : `${Math.round(seconds / 60)} min`;
}

function ActivityItem({ organizationId, activity }: { organizationId: string; activity: HarveyActivity }) {
  const [open, setOpen] = useState(false);
  const { icon: Icon, className } = STATUS_ICON[activity.status];
  const reasons = activity.rationale?.reasons ?? [];
  const evidence = activity.rationale?.evidence ?? [];
  const hasDetails = reasons.length > 0 || evidence.length > 0 || Boolean(activity.errorMessage);
  const took = duration(activity);

  return (
    <li className="flex gap-3 border-b border-border py-3 last:border-0">
      <time
        dateTime={activity.startedAt}
        title={new Date(activity.startedAt).toLocaleString('pt-BR')}
        className="w-11 shrink-0 pt-0.5 text-xs tabular-nums text-muted-foreground"
      >
        {clockTime(activity.startedAt)}
      </time>
      <Icon className={cn('mt-0.5 size-4 shrink-0', className)} aria-label={ACTIVITY_STATUS_LABELS[activity.status]} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-sm">{activity.title}</p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>{PHASE_LABELS[activity.phase]}</span>
          <span>{ACTIVITY_STATUS_LABELS[activity.status]}</span>
          {took && <span>{took}</span>}
          {activity.actorType === 'USER' && <span>ação de uma pessoa</span>}
          {activity.leadId && (
            <Link
              href={`/organizations/${organizationId}/leads/${activity.leadId}`}
              className="text-accent-500 hover:underline"
            >
              {activity.leadName ?? 'Ver lead'}
            </Link>
          )}
          {hasDetails && (
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              aria-expanded={open}
              className="inline-flex items-center gap-0.5 text-foreground hover:underline"
            >
              {activity.errorMessage && reasons.length === 0 ? 'Detalhes' : 'Por quê'}
              <ChevronDown className={cn('size-3 transition-transform', open && 'rotate-180')} aria-hidden />
            </button>
          )}
        </div>
        {open && (
          <div className="mt-1 flex flex-col gap-2 rounded-md bg-ink-800 p-3 text-xs">
            {activity.rationale?.summary && <p className="font-medium">{activity.rationale.summary}</p>}
            {reasons.length > 0 && (
              <ul className="list-disc space-y-0.5 pl-4">
                {reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            )}
            {evidence.length > 0 && (
              <ul className="space-y-1">
                {evidence.map((item, index) => (
                  <li key={index} className="text-muted-foreground">
                    “{item.quote}”
                    {item.url && (
                      <>
                        {' '}
                        <a href={item.url} target="_blank" rel="noopener noreferrer nofollow" className="text-accent-500 hover:underline">
                          fonte
                        </a>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {activity.errorMessage && <p className="text-negative-500">{activity.errorMessage}</p>}
          </div>
        )}
      </div>
    </li>
  );
}

export function HarveyTimeline({ organizationId }: { organizationId: string }) {
  const [filters, setFilters] = useState<ActivityFilters>({});
  const activities = useHarveyActivities(organizationId, filters);
  const items = activities.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-medium">Atividades</h2>
          <p className="text-xs text-muted-foreground">Atualiza sozinha, em tempo real.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select
            aria-label="Filtrar por etapa"
            value={filters.phase ?? ''}
            onChange={(event) => setFilters((current) => ({ ...current, phase: event.target.value || undefined }))}
          >
            <option value="">Todas as etapas</option>
            {(Object.keys(PHASE_LABELS) as HarveyPhase[]).map((phase) => (
              <option key={phase} value={phase}>
                {PHASE_LABELS[phase]}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Filtrar por status"
            value={filters.status ?? ''}
            onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value || undefined }))}
          >
            <option value="">Todos os status</option>
            {(Object.keys(ACTIVITY_STATUS_LABELS) as HarveyActivityStatus[]).map((status) => (
              <option key={status} value={status}>
                {ACTIVITY_STATUS_LABELS[status]}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {activities.isLoading && <Skeleton className="h-48 w-full" />}
      <FormError message={activities.isError ? (activities.error as ApiError).message : null} />
      {!activities.isLoading && items.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Nenhuma atividade ainda. Quando o Harvey começar, cada passo aparece aqui.
        </p>
      )}
      <ol aria-live="polite" aria-relevant="additions" className="flex flex-col">
        {items.map((activity) => (
          <ActivityItem key={activity.id} organizationId={organizationId} activity={activity} />
        ))}
      </ol>
      {activities.hasNextPage && (
        <Button
          variant="ghost"
          size="sm"
          className="self-center"
          disabled={activities.isFetchingNextPage}
          onClick={() => void activities.fetchNextPage()}
        >
          {activities.isFetchingNextPage ? 'Carregando…' : 'Ver mais antigas'}
        </Button>
      )}
      {items[0] && (
        <p className="text-right text-xs text-muted-foreground">Última atividade {relativeTime(items[0].startedAt)}</p>
      )}
    </Card>
  );
}
