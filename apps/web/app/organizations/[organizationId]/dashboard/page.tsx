'use client';

import { useParams } from 'next/navigation';
import clsx from 'clsx';
import {
  useDashboard,
  useLeadPipelineOverview,
  type LeadPipelineOverview,
  type LeadsByDayPoint,
  type LeadStatus,
} from '@/lib/dashboard/use-dashboard';
import { useAiUsage } from '@/lib/ai/use-ai-chat';
import { Badge } from '@/components/ui/badge';
import { LeadScoreBar } from '@/components/leads/lead-score-bar';
import { BudgetBar } from '@/components/ai/budget-bar';
import { BarChartHighlighted, DonutChart, LineChartWithTooltip, SparklineChart } from '@/components/ui/chart-card';

// ── Widgets 1/2 (KPIs "Leads sem site" / "Leads encontrados (14 dias)") ────
//
// Fórmula de delta (não especificada no brief da Task 9, escolhida aqui):
// soma dos últimos 7 dias corridos vs. soma dos 7 dias corridos IMEDIATAMENTE
// anteriores, sobre a mesma série diária usada no sparkline/gráfico de linha.
// `pct` fica `null` (não NaN/Infinity) quando a janela anterior é zero — o
// badge mostra só a diferença absoluta nesse caso ("+3" sem "%").
//
// Fix round 1 (review da Task 9): o widget 2 era rotulado "(mês)" mas seu
// headline era uma soma por mês-calendário enquanto o sparkline/delta
// desenhados no MESMO card usavam uma janela rolante de 14 dias — dois
// recortes de tempo incompatíveis, autocontraditórios no início de
// qualquer mês (headline pequeno de "só esse mês" sobre um sparkline/delta
// que refletia principalmente o mês anterior). Corrigido realinhando o
// widget inteiro (rótulo + headline + sparkline + delta) pra descrever uma
// única janela: os últimos 14 dias corridos.
const DELTA_WINDOW_DAYS = 7;
const SPARKLINE_DAYS = 14;
const TREND_CHART_DAYS = 30;

// Índice de assinatura extra pra bater estruturalmente com
// `Array<Record<string, string | number>>` (o tipo de `data` aceito por
// `SparklineChart`/`LineChartWithTooltip`, components/ui/chart-card.tsx).
interface DailyPoint {
  date: string;
  value: number;
  [key: string]: string | number;
}

// O backend (`DashboardService.getLeadPipelineOverview`, via `$queryRaw` +
// `GROUP BY date_trunc('day', discovered_at)`) só retorna uma linha por dia
// que tiver PELO MENOS um lead — mesmo padrão de
// `AiUsageService.getDailySeries` (apps/api/src/modules/ai/services/ai-usage.service.ts).
// Preenchemos os dias sem nenhum lead com 0 aqui no front: sem isso, tanto o
// sparkline/gráfico de linha quanto a janela de 7 dias do delta ficariam
// incorretos em qualquer período com pelo menos um dia sem lead nenhum.
function buildDailySeries(points: LeadsByDayPoint[], days: number, key: 'total' | 'withoutWebsite'): DailyPoint[] {
  const byDate = new Map(points.map((p) => [p.date, p[key]]));
  const series: DailyPoint[] = [];
  const cursor = new Date();
  cursor.setUTCHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(cursor);
    day.setUTCDate(day.getUTCDate() - i);
    const iso = day.toISOString().slice(0, 10);
    series.push({ date: iso, value: byDate.get(iso) ?? 0 });
  }
  return series;
}

function sumLastDays(series: DailyPoint[], count: number, offsetFromEnd: number): number {
  const end = series.length - offsetFromEnd;
  const start = end - count;
  return series.slice(Math.max(0, start), Math.max(0, end)).reduce((sum, p) => sum + p.value, 0);
}

interface Delta {
  diff: number;
  pct: number | null;
}

function computeDelta(series: DailyPoint[]): Delta {
  const current = sumLastDays(series, DELTA_WINDOW_DAYS, 0);
  const previous = sumLastDays(series, DELTA_WINDOW_DAYS, DELTA_WINDOW_DAYS);
  return { diff: current - previous, pct: previous === 0 ? null : (current - previous) / previous };
}

function formatDayLabel(iso: string): string {
  const [, month, day] = iso.split('-');
  return `${day}/${month}`;
}

// Soma o valor de todos os pontos de uma série diária já preenchida
// (`buildDailySeries`) — usado pro headline do KPI "Leads encontrados",
// que precisa somar EXATAMENTE a mesma janela de dias mostrada no sparkline
// e usada no cálculo do delta abaixo dele (ver nota de correção no
// relatório da Task 9, "Fix round 1": a primeira versão misturava um
// headline por mês-calendário com sparkline/delta de 14 dias corridos —
// dois recortes de tempo incompatíveis no mesmo card).
function sumSeries(series: DailyPoint[]): number {
  return series.reduce((sum, p) => sum + p.value, 0);
}

function DeltaBadge({ delta, colorCoded = false }: { delta: Delta; colorCoded?: boolean }) {
  const arrow = delta.diff > 0 ? '▲' : delta.diff < 0 ? '▼' : '→';
  const diffLabel = `${delta.diff > 0 ? '+' : ''}${delta.diff}`;
  const pctLabel = delta.pct === null ? '' : ` (${delta.pct >= 0 ? '+' : ''}${Math.round(delta.pct * 100)}%)`;
  const colorClass =
    colorCoded && delta.diff > 0
      ? 'bg-positive-500/10 text-positive-500'
      : colorCoded && delta.diff < 0
        ? 'bg-negative-500/10 text-negative-500'
        : 'bg-muted text-muted-foreground';
  return (
    <span className={clsx('inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', colorClass)}>
      {arrow} {diffLabel}
      {pctLabel}
    </span>
  );
}

function KpiCard({
  label,
  value,
  sparklineData,
  delta,
  colorCodedDelta = false,
}: {
  label: string;
  value: number;
  sparklineData: DailyPoint[];
  delta: Delta;
  colorCodedDelta?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <div className="mt-1 flex items-end justify-between gap-2">
        <p className="text-3xl font-semibold text-foreground">{value}</p>
        <DeltaBadge delta={delta} colorCoded={colorCodedDelta} />
      </div>
      <div className="mt-3">
        <SparklineChart data={sparklineData} dataKey="value" />
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        últimos {DELTA_WINDOW_DAYS} dias vs. {DELTA_WINDOW_DAYS} anteriores
      </p>
    </div>
  );
}

// Widget 3 ("Taxa de qualificação"): o backend não expõe uma série histórica
// de `qualificationRate` (só o valor atual), então a "tendência pequena" é
// aproximada comparando a taxa entre os `recentLeads` (últimos 8, já
// resolvidos como QUALIFIED/DISQUALIFIED) contra a taxa geral — não é uma
// tendência temporal de verdade, é um proxy "recente vs. geral". `null`
// quando nenhum dos 8 leads recentes está resolvido ainda.
function recentQualificationTrend(recentLeads: LeadPipelineOverview['recentLeads'], overallRate: number): number | null {
  const resolved = recentLeads.filter((l) => l.status === 'QUALIFIED' || l.status === 'DISQUALIFIED');
  if (resolved.length === 0) return null;
  const recentRate = resolved.filter((l) => l.status === 'QUALIFIED').length / resolved.length;
  return recentRate - overallRate;
}

function QualificationRateCard({ rate, trend }: { rate: number; trend: number | null }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-sm text-muted-foreground">Taxa de qualificação</p>
      <p className="mt-1 text-3xl font-semibold text-foreground">{Math.round(rate * 100)}%</p>
      {trend === null ? (
        <p className="mt-3 text-xs text-muted-foreground">Leads recentes ainda não pontuados o bastante pra uma tendência.</p>
      ) : (
        <p
          className={clsx(
            'mt-3 text-xs font-medium',
            trend > 0 ? 'text-positive-500' : trend < 0 ? 'text-negative-500' : 'text-muted-foreground',
          )}
        >
          {trend > 0 ? '▲' : trend < 0 ? '▼' : '→'} {Math.abs(Math.round(trend * 100))}pp vs. geral (últimos leads)
        </p>
      )}
    </div>
  );
}

function DarkCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-medium text-foreground">{title}</h2>
      {children}
    </div>
  );
}

// Widget "Inteligência de IA" — mesma fonte de dados do painel de Uso de IA
// (`useAiUsage`, apps/web/lib/ai/use-ai-chat.ts → AiUsageService.getSummary()
// no backend), só um recorte compacto pro dashboard: total de requests, custo
// estimado do mês e o BudgetBar já usado em `ai/usage`. Não inclui uma métrica
// de "tool accuracy" — a API não expõe isso hoje e inventar o número aqui
// seria fabricar dado.
function AiIntelligenceCard({ organizationId }: { organizationId: string }) {
  const usage = useAiUsage(organizationId);

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-medium text-foreground">Inteligência de IA</h2>
      {usage.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {usage.isError && <p className="text-sm text-negative-500">Não foi possível carregar o uso de IA.</p>}
      {usage.isSuccess && (
        <div className="flex flex-col gap-3">
          <div className="flex items-baseline gap-2">
            <p className="text-3xl font-semibold text-foreground">{usage.data.totalRequests}</p>
            <p className="text-sm text-muted-foreground">requests este mês</p>
          </div>
          <BudgetBar monthSpend={usage.data.monthSpend} monthlyBudget={usage.data.monthlyBudget} />
        </div>
      )}
    </div>
  );
}

const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  DISCOVERED: 'Descoberto',
  QUALIFIED: 'Qualificado',
  DISQUALIFIED: 'Desqualificado',
  OUTREACH_DRAFTED: 'Rascunho de contato',
  OUTREACH_APPROVED: 'Contato aprovado',
  CONTACTED: 'Contatado',
  REPLIED: 'Respondeu',
  CONVERTED: 'Convertido',
  LOST: 'Perdido',
};

// Não inclui o tile "Pipeline (valor estimado)" citado no brief original da
// feature — não há campo de valor de negócio modelado em `Lead`/`Customer`
// (schema já decidido, ver docs/superpowers/plans/2026-09-02-leads-prospecting-dashboard.md);
// inventar um campo novo fora desse schema estaria fora do escopo desta task.
function LeadPipelineSection({ data, organizationId }: { data: LeadPipelineOverview; organizationId: string }) {
  const withoutWebsiteSeries = buildDailySeries(data.leadsByDay, SPARKLINE_DAYS, 'withoutWebsite');
  const totalSeries14d = buildDailySeries(data.leadsByDay, SPARKLINE_DAYS, 'total');
  const totalSeries30d = buildDailySeries(data.leadsByDay, TREND_CHART_DAYS, 'total');

  const websiteDelta = computeDelta(withoutWebsiteSeries);
  const totalDelta = computeDelta(totalSeries14d);
  // Headline do KPI "Leads encontrados (14 dias)" — soma da MESMA janela de
  // 14 dias plotada no sparkline logo abaixo e usada no cálculo do delta
  // (`totalDelta`), pra o card inteiro (número, sparkline, delta) descrever
  // um único recorte de tempo. Ver comentário de `sumSeries` acima.
  const total14dCount = sumSeries(totalSeries14d);
  const qualificationTrend = recentQualificationTrend(data.recentLeads, data.qualificationRate);

  const statusData = (Object.entries(data.leadsByStatus) as Array<[LeadStatus, number]>)
    .filter(([, count]) => count > 0)
    .map(([status, count]) => ({ name: LEAD_STATUS_LABELS[status], value: count }));

  const cityData = data.leadsByCity.map((c) => ({
    label: [c.city, c.state].filter(Boolean).join('/') || 'Sem cidade',
    count: c.count,
    withoutWebsite: c.withoutWebsite,
  }));
  const topWithoutWebsiteCity = cityData.reduce<(typeof cityData)[number] | null>(
    (max, c) => (c.withoutWebsite > 0 && c.withoutWebsite > (max?.withoutWebsite ?? -1) ? c : max),
    null,
  );

  const lineData = totalSeries30d.map((p) => ({ date: formatDayLabel(p.date), value: p.value }));

  return (
    <section className="flex flex-col gap-6">
      <h2 className="text-sm font-medium text-muted-foreground">Pipeline de leads</h2>

      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard
          label="Leads sem site"
          value={data.leadsWithoutWebsite}
          sparklineData={withoutWebsiteSeries}
          delta={websiteDelta}
        />
        <KpiCard
          label="Leads encontrados (14 dias)"
          value={total14dCount}
          sparklineData={totalSeries14d}
          delta={totalDelta}
          colorCodedDelta
        />
        <QualificationRateCard rate={data.qualificationRate} trend={qualificationTrend} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <DarkCard title="Leads por status">
          {statusData.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum lead ainda.</p>
          ) : (
            <DonutChart data={statusData} />
          )}
        </DarkCard>
        <DarkCard title="Leads por cidade (top 8)">
          {cityData.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum dado por cidade ainda.</p>
          ) : (
            <>
              <BarChartHighlighted data={cityData} dataKey="count" nameKey="label" highlightValue={topWithoutWebsiteCity?.label} />
              {topWithoutWebsiteCity && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Em destaque: <span className="text-accent-400">{topWithoutWebsiteCity.label}</span> — cidade com mais leads sem
                  site ({topWithoutWebsiteCity.withoutWebsite}).
                </p>
              )}
            </>
          )}
        </DarkCard>
      </div>

      <DarkCard title="Leads ao longo do tempo (30 dias)">
        <LineChartWithTooltip data={lineData} dataKey="value" xKey="date" highlightLast />
      </DarkCard>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <DarkCard title="Leads recentes">
          {data.recentLeads.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum lead descoberto ainda.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {data.recentLeads.map((lead) => (
                <li key={lead.id} className="flex flex-col gap-2 rounded-md border border-border bg-background px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-foreground">{lead.name}</span>
                    <Badge value={lead.status} />
                  </div>
                  <span className="text-xs text-muted-foreground">{[lead.city, lead.state].filter(Boolean).join('/') || '—'}</span>
                  {lead.scoreBreakdown ? (
                    <LeadScoreBar breakdown={lead.scoreBreakdown} />
                  ) : (
                    <span className="text-xs text-muted-foreground">não pontuado</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </DarkCard>

        <DarkCard title="Atividade de scrape jobs">
          {data.recentScrapeJobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma busca disparada ainda.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {data.recentScrapeJobs.map((job) => (
                <li
                  key={job.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm"
                >
                  <div className="flex flex-col">
                    <span className="text-foreground">
                      {job.businessType} em {job.city}/{job.state}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {job.leadsFound} lead{job.leadsFound === 1 ? '' : 's'} encontrado{job.leadsFound === 1 ? '' : 's'} ·{' '}
                      {new Date(job.createdAt).toLocaleString('pt-BR')}
                    </span>
                  </div>
                  <Badge value={job.status} />
                </li>
              ))}
            </ul>
          )}
        </DarkCard>

        <AiIntelligenceCard organizationId={organizationId} />
      </div>
    </section>
  );
}

function StatCardDark({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-3xl font-semibold text-foreground">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export default function OrganizationDashboardPage() {
  const { organizationId } = useParams<{ organizationId: string }>();
  const dashboard = useDashboard(organizationId);
  const leadPipeline = useLeadPipelineOverview(organizationId);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Pipeline de leads e visão geral de clientes/tarefas.</p>
      </div>

        {leadPipeline.isLoading && <p className="text-muted-foreground">Carregando pipeline de leads…</p>}
        {leadPipeline.isError && (
          <p className="text-negative-500">Não foi possível carregar o pipeline de leads desta organização.</p>
        )}
        {leadPipeline.isSuccess && <LeadPipelineSection data={leadPipeline.data} organizationId={organizationId} />}

        <section className="flex flex-col gap-6 border-t border-border pt-8">
          <h2 className="text-sm font-medium text-muted-foreground">Clientes e tarefas</h2>

          {dashboard.isLoading && <p className="text-muted-foreground">Carregando dashboard…</p>}
          {dashboard.isError && (
            <p className="text-negative-500">Não foi possível carregar o dashboard desta organização.</p>
          )}

          {dashboard.isSuccess && (
            <>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <StatCardDark label="Clientes" value={dashboard.data.customers.total} />
                <StatCardDark
                  label="Inativos"
                  value={dashboard.data.customers.inactiveByRule}
                  hint="sem contato há tempo demais"
                />
                <StatCardDark label="Tarefas" value={dashboard.data.tasks.total} />
                <StatCardDark label="Em aberto" value={dashboard.data.tasks.byStatus.OPEN} />
              </div>

              <DarkCard title="Atividade recente">
                {dashboard.data.recentActivity.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhuma atividade registrada ainda.</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {dashboard.data.recentActivity.map((activity) => (
                      <li key={activity.id} className="flex justify-between text-sm">
                        <span className="text-foreground/80">{activity.type}</span>
                        <span className="text-muted-foreground">{new Date(activity.createdAt).toLocaleString('pt-BR')}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </DarkCard>
            </>
          )}
      </section>
    </div>
  );
}
