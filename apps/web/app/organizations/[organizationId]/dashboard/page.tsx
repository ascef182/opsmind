'use client';

import { useParams } from 'next/navigation';
import { DeltaBadge, type Delta } from '@/components/dashboard/delta-badge';
import clsx from 'clsx';
import Link from 'next/link';
import {
  useDashboard,
  useDealPipelineOverview,
  useLeadPipelineOverview,
  useSalesForecast,
  type DealPipelineOverview,
  type LeadPipelineOverview,
  type LeadsByDayPoint,
  type LeadStatus,
  type SalesForecast,
} from '@/lib/dashboard/use-dashboard';
import { useAiUsage } from '@/lib/ai/use-ai-chat';
import { DEAL_STAGES, DEAL_STAGE_LABELS, formatCurrency } from '@/lib/deals/types';
import { Badge } from '@/components/ui/badge';
import { LeadScoreBar } from '@/components/leads/lead-score-bar';
import { ForecastBreakdown } from '@/components/dashboard/forecast-breakdown';
import { BudgetBar } from '@/components/ai/budget-bar';
import { FinanceSnapshotSection } from '@/components/finance/dashboard-snapshot';
import {
  BarChartHighlighted,
  DonutChart,
  LineChartWithTooltip,
  SparklineChart,
} from '@/components/ui/chart-card';
import { Skeleton } from '@/components/ui/skeleton';

// Skeleton de página inteira — mostrado enquanto QUALQUER uma das 4 consultas
// principais ainda carrega, pra não aparecer em pedaços conforme cada uma
// resolve na sua própria velocidade (cada seção mantém seu próprio
// isError/isSuccess depois disso, sem mudança).
function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-64" />
      <Skeleton className="h-48" />
    </div>
  );
}

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
function buildDailySeries(
  points: LeadsByDayPoint[],
  days: number,
  key: 'total' | 'withoutWebsite',
): DailyPoint[] {
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
function recentQualificationTrend(
  recentLeads: LeadPipelineOverview['recentLeads'],
  overallRate: number,
): number | null {
  const resolved = recentLeads.filter(
    (l) => l.status === 'QUALIFIED' || l.status === 'DISQUALIFIED',
  );
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
        <p className="mt-3 text-xs text-muted-foreground">
          Leads recentes ainda não pontuados o bastante pra uma tendência.
        </p>
      ) : (
        <p
          className={clsx(
            'mt-3 text-xs font-medium',
            trend > 0
              ? 'text-positive-500'
              : trend < 0
                ? 'text-negative-500'
                : 'text-muted-foreground',
          )}
        >
          {trend > 0 ? '▲' : trend < 0 ? '▼' : '→'} {Math.abs(Math.round(trend * 100))}pp vs. geral
          (últimos leads)
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
      {usage.isError && (
        <p className="text-sm text-negative-500">Não foi possível carregar o uso de IA.</p>
      )}
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

// O tile "Pipeline (valor estimado)" citado no brief original da feature de
// leads não existia porque não havia campo de valor de negócio modelado em
// `Lead`/`Customer` (ver docs/superpowers/plans/2026-09-02-leads-prospecting-dashboard.md).
// Isso mudou com o pipeline de Deal (plano
// pensando-como-empresa-com-agile-beaver.md) — ver `DealPipelineSection`
// abaixo, uma seção própria, não um tile dentro desta.
function LeadPipelineSection({
  data,
  organizationId,
}: {
  data: LeadPipelineOverview;
  organizationId: string;
}) {
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
              <BarChartHighlighted
                data={cityData}
                dataKey="count"
                nameKey="label"
                highlightValue={topWithoutWebsiteCity?.label}
              />
              {topWithoutWebsiteCity && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Em destaque:{' '}
                  <span className="text-accent-400">{topWithoutWebsiteCity.label}</span> — cidade
                  com mais leads sem site ({topWithoutWebsiteCity.withoutWebsite}).
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
                <li
                  key={lead.id}
                  className="flex flex-col gap-2 rounded-md border border-border bg-background px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-foreground">
                      {lead.name}
                    </span>
                    <Badge value={lead.status} />
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {[lead.city, lead.state].filter(Boolean).join('/') || '—'}
                  </span>
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
                      {job.leadsFound} lead{job.leadsFound === 1 ? '' : 's'} encontrado
                      {job.leadsFound === 1 ? '' : 's'} ·{' '}
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

// Painel de pipeline de negociação (plano
// pensando-como-empresa-com-agile-beaver.md) — aditivo, seção própria abaixo
// do pipeline de leads, mesma disciplina de não alterar as seções
// existentes que `getDealPipelineOverview` já segue no backend.
// Abaixo disso, um percentual/dia isolado é mais ruído estatístico do que
// sinal (ex.: 100% de 2 negócios fechados não é o mesmo tipo de informação
// que 100% de 200) — achado real (2026-09): a UI mostrava esses números sem
// nenhum contexto de tamanho de amostra. Ajustável; não é um valor calibrado
// contra dado real, só um piso razoável.
const MIN_SAMPLE_FOR_CONFIDENT_STATS = 5;

function DealPipelineSection({
  data,
  organizationId,
}: {
  data: DealPipelineOverview;
  organizationId: string;
}) {
  const maxStageValue = Math.max(1, ...DEAL_STAGES.map((stage) => data.dealsByStage[stage].value));
  const wonCount = data.dealsByStage.WON.count;

  return (
    <section className="flex flex-col gap-6 border-t border-border pt-8">
      <h2 className="text-sm font-medium text-muted-foreground">Pipeline de negociação</h2>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCardDark label="Valor em aberto" value={formatCurrency(data.openValue)} />
        <StatCardDark
          label="Taxa de vitória"
          value={
            data.closedDealCount < MIN_SAMPLE_FOR_CONFIDENT_STATS
              ? '—'
              : `${Math.round(data.winRate * 100)}%`
          }
          hint={
            data.closedDealCount === 0
              ? 'nenhum negócio fechado ainda'
              : data.closedDealCount < MIN_SAMPLE_FOR_CONFIDENT_STATS
                ? `poucos negócios fechados ainda (n=${data.closedDealCount}) — ainda não é um sinal confiável`
                : `dos negócios fechados (n=${data.closedDealCount})`
          }
        />
        <StatCardDark
          label="Ciclo médio de venda"
          value={
            data.avgSalesCycleDays === null ? '—' : `${Math.round(data.avgSalesCycleDays)} dias`
          }
          hint={
            data.avgSalesCycleDays === null
              ? 'nenhum negócio ganho ainda'
              : wonCount < MIN_SAMPLE_FOR_CONFIDENT_STATS
                ? `poucos negócios ganhos ainda (n=${wonCount}) — valor pode não refletir o ciclo real`
                : 'entre criação e fechamento'
          }
        />
        <StatCardDark
          label="Propostas assinadas"
          value={`${data.signatureFunnel.signed}/${data.signatureFunnel.sent}`}
          hint={
            data.signatureFunnel.sent === 0
              ? 'nenhuma enviada pra assinatura ainda'
              : 'assinadas / enviadas'
          }
        />
      </div>

      <DarkCard title="Negócios por estágio">
        <ul className="flex flex-col gap-2">
          {DEAL_STAGES.map((stage) => {
            const bucket = data.dealsByStage[stage];
            const widthPct = Math.max(2, (bucket.value / maxStageValue) * 100);
            return (
              <li key={stage} className="flex items-center gap-3">
                <span className="w-32 shrink-0 text-xs text-muted-foreground">
                  {DEAL_STAGE_LABELS[stage]}
                </span>
                <div className="h-2 flex-1 rounded-full bg-ink-800">
                  <div
                    className="h-2 rounded-full bg-accent-500"
                    style={{ width: `${widthPct}%` }}
                  />
                </div>
                <span className="w-28 shrink-0 text-right text-xs text-muted-foreground">
                  {bucket.count} · {formatCurrency(bucket.value)}
                </span>
              </li>
            );
          })}
        </ul>
      </DarkCard>

      <div className="grid gap-4 md:grid-cols-2">
        <DarkCard title="Fechando em breve (30 dias)">
          {data.dealsClosingSoon.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum negócio com fechamento previsto nos próximos 30 dias.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {data.dealsClosingSoon.map((deal) => (
                <li key={deal.id}>
                  <Link
                    href={`/organizations/${organizationId}/deals/${deal.id}`}
                    className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-sm hover:border-accent-500/40"
                  >
                    <span className="truncate text-foreground">{deal.title}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="text-muted-foreground">
                        {formatCurrency(deal.value, deal.currency)}
                      </span>
                      <Badge value={deal.stage} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </DarkCard>

        <DarkCard title="Ganhos recentes">
          {data.recentlyWonDeals.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum negócio ganho ainda.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {data.recentlyWonDeals.map((deal) => (
                <li key={deal.id}>
                  <Link
                    href={`/organizations/${organizationId}/deals/${deal.id}`}
                    className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-sm hover:border-accent-500/40"
                  >
                    <span className="truncate text-foreground">{deal.title}</span>
                    <span className="text-positive-500">
                      {formatCurrency(deal.value, deal.currency)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </DarkCard>
      </div>
    </section>
  );
}

function formatMonthLabel(month: string): string {
  const [yearPart, monthPart] = month.split('-');
  const year = Number(yearPart);
  const monthIndex = Number(monthPart) - 1;
  return new Date(Date.UTC(year, monthIndex, 1)).toLocaleDateString('pt-BR', {
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  });
}

// Trilha C (forecasting, plano pensando-como-empresa-com-agile-beaver.md) —
// pipeline ponderado por probabilidade de estágio (`DEAL_STAGE_PROBABILITY`
// no backend) + tendência de receita fechada. Seção própria, mesma
// disciplina aditiva de `DealPipelineSection`.
function SalesForecastSection({ data }: { data: SalesForecast }) {
  const forecastChartData = data.forecastByMonth.map((bucket) => ({
    month: formatMonthLabel(bucket.month),
    weightedValue: Math.round(bucket.weightedValue),
  }));
  const revenueChartData = data.wonRevenueByMonth.map((point) => ({
    month: formatMonthLabel(point.month),
    wonValue: Math.round(point.wonValue),
  }));

  return (
    <section className="flex flex-col gap-6 border-t border-border pt-8">
      <h2 className="text-sm font-medium text-muted-foreground">Previsão de fechamento</h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <ForecastBreakdown
          weightedPipelineValue={data.weightedPipelineValue}
          weightedPipelineByStage={data.weightedPipelineByStage}
        />
        <StatCardDark
          label="Sem previsão de fechamento"
          value={formatCurrency(data.unscheduledValue)}
          hint="negócios abertos sem data esperada"
        />
      </div>

      <DarkCard title="Previsão por mês (valor ponderado)">
        {forecastChartData.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum negócio aberto com data de fechamento esperada.
          </p>
        ) : (
          <BarChartHighlighted data={forecastChartData} dataKey="weightedValue" nameKey="month" />
        )}
      </DarkCard>

      <DarkCard title="Receita fechada (últimos 6 meses)">
        <LineChartWithTooltip
          data={revenueChartData}
          dataKey="wonValue"
          xKey="month"
          highlightLast
        />
      </DarkCard>
    </section>
  );
}

function StatCardDark({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | string;
  hint?: string;
}) {
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
  const dealPipeline = useDealPipelineOverview(organizationId);
  const salesForecast = useSalesForecast(organizationId);

  // Um só gate pras 4 consultas principais — sem isso, cada seção aparecia
  // num momento diferente conforme sua consulta terminava, dando a impressão
  // de página quebrada/"não atualizando". `FinanceSnapshotSection` fica fora
  // de propósito: é gated por permissão (nem dispara consulta pra quem não
  // pode ver o financeiro) e já tem seu próprio carregamento contido.
  const loading =
    dashboard.isLoading ||
    leadPipeline.isLoading ||
    dealPipeline.isLoading ||
    salesForecast.isLoading;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Pipeline de leads e visão geral de clientes/tarefas.
        </p>
      </div>

      {loading ? (
        <DashboardSkeleton />
      ) : (
        <>
          {leadPipeline.isError && (
            <p className="text-negative-500">
              Não foi possível carregar o pipeline de leads desta organização.
            </p>
          )}
          {leadPipeline.isSuccess && (
            <LeadPipelineSection data={leadPipeline.data} organizationId={organizationId} />
          )}

          {dealPipeline.isError && (
            <p className="text-negative-500">
              Não foi possível carregar o pipeline de negociação desta organização.
            </p>
          )}
          {dealPipeline.isSuccess && (
            <DealPipelineSection data={dealPipeline.data} organizationId={organizationId} />
          )}

          {salesForecast.isError && (
            <p className="text-negative-500">
              Não foi possível carregar a previsão de fechamento desta organização.
            </p>
          )}
          {salesForecast.isSuccess && <SalesForecastSection data={salesForecast.data} />}

          <FinanceSnapshotSection organizationId={organizationId} />

          <section className="flex flex-col gap-6 border-t border-border pt-8">
            <h2 className="text-sm font-medium text-muted-foreground">Clientes e tarefas</h2>

            {dashboard.isError && (
              <p className="text-negative-500">
                Não foi possível carregar o dashboard desta organização.
              </p>
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
                    <p className="text-sm text-muted-foreground">
                      Nenhuma atividade registrada ainda.
                    </p>
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {dashboard.data.recentActivity.map((activity) => (
                        <li key={activity.id} className="flex justify-between text-sm">
                          <span className="text-foreground/80">{activity.type}</span>
                          <span className="text-muted-foreground">
                            {new Date(activity.createdAt).toLocaleString('pt-BR')}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </DarkCard>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
