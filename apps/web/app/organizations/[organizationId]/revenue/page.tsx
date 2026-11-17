'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { PauseCircle } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { FormError } from '@/components/ui/card';
import {
  KpiTile,
  PERIOD_OPTIONS,
  PeriodToggle,
  formatMoneyByCurrency,
  formatUsd,
} from '@/components/revenue/revenue-ui';
import { useRevenueOverview, useRevenueSettings } from '@/lib/revenue/use-revenue';
import { CopyPerformanceSection } from '@/components/revenue/copy-performance';
import { HarveyStatusStrip } from '@/components/harvey/harvey-status-strip';
import type { RevenueKpiKey, RevenueOverview, RevenuePeriod } from '@/lib/revenue/types';
import type { ApiError } from '@/lib/api-client';

const SECTIONS: Array<{ title: string; items: Array<{ key: RevenueKpiKey; label: string }> }> = [
  {
    title: 'Pesquisa',
    items: [
      { key: 'discovered', label: 'Negócios descobertos' },
      { key: 'withoutWebsite', label: 'Sem site' },
      { key: 'weakWebsite', label: 'Com site fraco' },
    ],
  },
  {
    title: 'Abordagem',
    items: [
      { key: 'outreachPrepared', label: 'Mensagens preparadas' },
      { key: 'messagesSent', label: 'Mensagens enviadas' },
      { key: 'repliesReceived', label: 'Respostas recebidas' },
      { key: 'positiveReplies', label: 'Respostas positivas' },
    ],
  },
  {
    title: 'Conversão',
    items: [
      { key: 'demosRequested', label: 'Demonstrações pedidas' },
      { key: 'previewsGenerated', label: 'Sites gerados' },
      { key: 'meetingsBooked', label: 'Reuniões marcadas' },
      { key: 'proposalsSent', label: 'Propostas enviadas' },
    ],
  },
];

export default function RevenueOverviewPage() {
  const { organizationId } = useParams<{ organizationId: string }>();
  const [period, setPeriod] = useState<RevenuePeriod>('day');
  const overview = useRevenueOverview(organizationId, period);
  const settings = useRevenueSettings(organizationId);
  const comparison = PERIOD_OPTIONS.find((option) => option.value === period)!.comparison;
  const paused = settings.data && (settings.data.outreachPaused || settings.data.globalPause);

  return (
    <div className="flex flex-col gap-6">
      <HarveyStatusStrip organizationId={organizationId} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{comparison}</p>
        <PeriodToggle value={period} onChange={setPeriod} />
      </div>

      {paused && (
        <div className="flex items-start gap-3 rounded-lg border border-border bg-card p-4">
          <PauseCircle className="mt-0.5 size-5 shrink-0 text-accent-500" aria-hidden />
          <div className="flex flex-col gap-1 text-sm">
            <p className="font-medium">Envio de outreach pausado</p>
            <p className="text-muted-foreground">
              Rascunhos continuam sendo gerados para revisão, mas nenhum e-mail sai até o envio ser liberado.{' '}
              <Link href={`/organizations/${organizationId}/revenue/settings`} className="text-accent-500 hover:underline">
                Ver configurações
              </Link>
            </p>
          </div>
        </div>
      )}

      {overview.isLoading && <OverviewSkeleton />}
      {overview.isError && <FormError message={(overview.error as ApiError).message} />}
      {overview.data && <OverviewContent data={overview.data} />}
      <CopyPerformanceSection organizationId={organizationId} />
    </div>
  );
}

function OverviewContent({ data }: { data: RevenueOverview }) {
  const { kpis } = data;
  return (
    <>
      <section aria-labelledby="revenue-headline" className="flex flex-col gap-3">
        <h2 id="revenue-headline" className="sr-only">
          Resultado do período
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiTile label="Oportunidades qualificadas" kpi={kpis.qualified} emphasis />
          <KpiTile label="Negócios ganhos" kpi={kpis.dealsWon} emphasis />
          <Card className="flex flex-col gap-1 p-4">
            <span className="text-xs text-muted-foreground">Receita gerada</span>
            <span className="text-3xl font-semibold tabular-nums">{formatMoneyByCurrency(data.revenue.current)}</span>
            <span className="text-xs text-muted-foreground">
              Período anterior: {formatMoneyByCurrency(data.revenue.previous)}
            </span>
          </Card>
          <Card className="flex flex-col gap-1 p-4">
            <span className="text-xs text-muted-foreground">Custo de aquisição</span>
            <span className="text-3xl font-semibold tabular-nums">
              {data.acquisitionCostUsd.current === null ? '—' : formatUsd(data.acquisitionCostUsd.current)}
            </span>
            <span className="text-xs text-muted-foreground">gasto do período por negócio ganho</span>
          </Card>
        </div>
      </section>

      {SECTIONS.map((section) => (
        <section key={section.title} className="flex flex-col gap-3">
          <h2 className="text-h2">{section.title}</h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {section.items.map((item) => (
              <KpiTile key={item.key} label={item.label} kpi={kpis[item.key]} />
            ))}
          </div>
        </section>
      ))}

      <section className="flex flex-col gap-3">
        <h2 className="text-h2">Economia</h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiTile label="Gasto (IA, pesquisa, e-mail)" kpi={kpis.spendUsd} format={formatUsd} invert />
          <Card className="flex flex-col gap-1 p-4">
            <span className="text-xs text-muted-foreground">Pipeline em aberto</span>
            <span className="text-xl font-semibold tabular-nums">{formatMoneyByCurrency(data.openPipelineValue)}</span>
            <span className="text-xs text-muted-foreground">valor dos negócios ainda não fechados</span>
          </Card>
        </div>
      </section>
    </>
  );
}

function OverviewSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 8 }, (_, index) => (
        <Skeleton key={index} className="h-24 w-full" />
      ))}
    </div>
  );
}
