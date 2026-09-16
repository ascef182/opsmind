import { Injectable } from '@nestjs/common';
import type {
  ActivityLog,
  CustomerStatus,
  Deal,
  DealStage,
  Lead,
  LeadStatus,
  ScrapeJob,
  TaskStatus,
} from '@opsmind/database';
import { PrismaService } from '../../infrastructure/database/prisma.service';

const CUSTOMER_STATUSES: CustomerStatus[] = ['LEAD', 'ACTIVE', 'INACTIVE'];
const TASK_STATUSES: TaskStatus[] = ['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED'];
const RECENT_ACTIVITY_LIMIT = 10;

const LEAD_STATUSES: LeadStatus[] = [
  'DISCOVERED',
  'QUALIFIED',
  'DISQUALIFIED',
  'OUTREACH_DRAFTED',
  'OUTREACH_APPROVED',
  'CONTACTED',
  'REPLIED',
  'CONVERTED',
  'LOST',
];
const LEADS_BY_DAY_WINDOW_DAYS = 30;
const TOP_CITIES_LIMIT = 8;
const RECENT_LEADS_LIMIT = 8;
const RECENT_SCRAPE_JOBS_LIMIT = 5;

const DEAL_STAGES: DealStage[] = [
  'QUALIFICATION',
  'PROPOSAL',
  'NEGOTIATION',
  'CONTRACT_SENT',
  'WON',
  'LOST',
];
const CLOSED_DEAL_STAGES: DealStage[] = ['WON', 'LOST'];
const DEALS_CLOSING_SOON_WINDOW_DAYS = 30;
const DEALS_CLOSING_SOON_LIMIT = 10;
const RECENTLY_WON_DEALS_LIMIT = 5;

// Probabilidade de fechamento por estágio (Trilha C, forecasting) — chute
// informado, não calibrado por dados históricos ainda (não há volume
// suficiente de deals fechados na base pra regressão). Única fonte de
// verdade: usada tanto no cálculo do pipeline ponderado abaixo quanto pela
// AI tool `get_sales_forecast` (`apps/api/src/modules/ai/tools`), que
// importa esta mesma constante — nunca duplicar o mapa em SQL bruto.
export const DEAL_STAGE_PROBABILITY: Record<DealStage, number> = {
  QUALIFICATION: 0.1,
  PROPOSAL: 0.3,
  NEGOTIATION: 0.6,
  CONTRACT_SENT: 0.85,
  WON: 1,
  LOST: 0,
};
const WON_REVENUE_TREND_MONTHS = 6;

export interface LeadsByCityBucket {
  city: string | null;
  state: string | null;
  count: number;
  withoutWebsite: number;
}

export interface LeadsByDayPoint {
  date: string;
  total: number;
  withoutWebsite: number;
}

export interface LeadPipelineOverview {
  totalLeads: number;
  leadsWithoutWebsite: number;
  // 0 quando não há nenhum lead QUALIFIED nem DISQUALIFIED ainda (denominador
  // zero) — nunca NaN/Infinity, mesmo racional de `avgLatencyMs` em
  // ai-usage.service.ts pra `_avg` nulo do Prisma.
  qualificationRate: number;
  leadsByStatus: Record<LeadStatus, number>;
  leadsByCity: LeadsByCityBucket[];
  leadsByDay: LeadsByDayPoint[];
  recentLeads: Lead[];
  recentScrapeJobs: ScrapeJob[];
}

interface LeadsByDayRow {
  day: Date;
  total: bigint | number;
  withoutWebsite: bigint | number;
}

export interface DealStageBucket {
  count: number;
  value: number;
}

export interface DealSignatureFunnel {
  // Toda `DealSignatureRequest` já criada (SENT/SIGNED/DECLINED/CANCELED) —
  // não só as ainda pendentes.
  sent: number;
  signed: number;
}

export interface DealPipelineOverview {
  openValue: number;
  dealsByStage: Record<DealStage, DealStageBucket>;
  // 0 quando não há nenhum deal WON nem LOST ainda (denominador zero) —
  // mesmo racional de `qualificationRate` acima.
  winRate: number;
  avgSalesCycleDays: number | null;
  dealsClosingSoon: Deal[];
  recentlyWonDeals: Deal[];
  // Funil de fechamento de verdade (trilha "proposta -> assinatura", plano
  // pensando-como-empresa-com-agile-beaver.md) — quantas propostas foram
  // enviadas pra assinatura vs. quantas voltaram assinadas.
  signatureFunnel: DealSignatureFunnel;
}

interface AvgSalesCycleRow {
  avgDays: number | null;
}

export interface ForecastMonthBucket {
  month: string; // 'YYYY-MM', mês de `expectedCloseDate`
  openValue: number;
  weightedValue: number;
  dealCount: number;
}

export interface WonRevenueMonthPoint {
  month: string; // 'YYYY-MM', mês de `actualCloseDate`
  wonValue: number;
  wonCount: number;
}

export interface SalesForecast {
  // Soma de `value * DEAL_STAGE_PROBABILITY[stage]` de todo deal aberto
  // (WON/LOST fora) — a "previsão realista" de receita, em vez do valor
  // bruto do pipeline (que superestima: nem toda negociação em QUALIFICATION
  // fecha).
  weightedPipelineValue: number;
  // Valor bruto dos deals abertos sem `expectedCloseDate` — não entra em
  // `forecastByMonth` (não tem em qual mês bucketizar), mas precisa aparecer
  // em algum lugar pra não sumir silenciosamente do pipeline ponderado.
  unscheduledValue: number;
  forecastByMonth: ForecastMonthBucket[];
  wonRevenueByMonth: WonRevenueMonthPoint[];
}

interface LeadsByCityRow {
  city: string | null;
  state: string | null;
  count: bigint | number;
  withoutWebsite: bigint | number;
}

export interface DashboardOverview {
  customers: {
    total: number;
    byStatus: Record<CustomerStatus, number>;
    // Regra de negócio do PRD §8 — distinta do campo `status` (que é
    // manual/definido por automação): conta quem não tem NENHUMA atividade
    // há mais de `organization.inactiveAfterDays` dias. Um cliente sem
    // nenhuma atividade ainda (lastActivityAt null) não entra aqui — é um
    // LEAD que ainda não começou, não alguém que "parou de responder".
    inactiveByRule: number;
  };
  tasks: {
    total: number;
    byStatus: Record<TaskStatus, number>;
  };
  recentActivity: ActivityLog[];
}

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

// Meses `count` a partir de `from`, incluindo-o, mais antigo primeiro —
// usado pra pré-preencher `wonRevenueByMonth` com zero (mesmo racional de
// `toCountMap`: um mês sem nenhum deal ganho não pode simplesmente sumir do
// array e quebrar a série temporal no gráfico do front).
function trailingMonthKeys(count: number, from: Date): string[] {
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    keys.push(monthKey(new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() - i, 1))));
  }
  return keys;
}

function toCountMap<T extends string>(
  groups: Array<{ status: T; _count: { _all: number } }>,
  statuses: T[],
): Record<T, number> {
  const map = Object.fromEntries(statuses.map((status) => [status, 0])) as Record<T, number>;
  for (const group of groups) {
    map[group.status] = group._count._all;
  }
  return map;
}

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(organizationId: string): Promise<DashboardOverview> {
    const [customersByStatus, tasksByStatus, organization, recentActivity] = await Promise.all([
      this.prisma.customer.groupBy({
        by: ['status'],
        where: { organizationId, deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.task.groupBy({
        by: ['status'],
        where: { organizationId },
        _count: { _all: true },
      }),
      this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId } }),
      this.prisma.activityLog.findMany({
        where: { organizationId },
        orderBy: { createdAt: 'desc' },
        take: RECENT_ACTIVITY_LIMIT,
      }),
    ]);

    const inactiveCutoff = new Date();
    inactiveCutoff.setDate(inactiveCutoff.getDate() - organization.inactiveAfterDays);

    const inactiveByRule = await this.prisma.customer.count({
      where: { organizationId, deletedAt: null, lastActivityAt: { lt: inactiveCutoff } },
    });

    const customersMap = toCountMap(customersByStatus, CUSTOMER_STATUSES);
    const tasksMap = toCountMap(tasksByStatus, TASK_STATUSES);

    return {
      customers: {
        total: Object.values(customersMap).reduce((sum, n) => sum + n, 0),
        byStatus: customersMap,
        inactiveByRule,
      },
      tasks: {
        total: Object.values(tasksMap).reduce((sum, n) => sum + n, 0),
        byStatus: tasksMap,
      },
      recentActivity,
    };
  }

  /**
   * Painel de pipeline de leads (Task 9). Aditivo — não altera `getOverview()`
   * nem sua rota; vive numa rota nova (`GET .../dashboard/leads`).
   */
  async getLeadPipelineOverview(organizationId: string): Promise<LeadPipelineOverview> {
    const dayWindowStart = new Date();
    dayWindowStart.setDate(dayWindowStart.getDate() - LEADS_BY_DAY_WINDOW_DAYS);

    const [totalLeads, leadsWithoutWebsite, leadsByStatusRaw, leadsByCityRows, leadsByDayRows, recentLeads, recentScrapeJobs] =
      await Promise.all([
        this.prisma.lead.count({ where: { organizationId } }),
        this.prisma.lead.count({
          where: { organizationId, OR: [{ website: null }, { website: '' }] },
        }),
        this.prisma.lead.groupBy({
          by: ['status'],
          where: { organizationId },
          _count: { _all: true },
        }),
        // Prisma não tem `COUNT(...) FILTER (WHERE ...)` em `groupBy` — sem
        // isso não dá pra saber, numa única query agrupada, quantos leads SEM
        // site cada cidade tem (necessário pro destaque do
        // `BarChartHighlighted` no front: a cidade com mais leads sem site).
        // Mesmo precedente de raw SQL de `AiUsageService.getDailySeries` /
        // `SearchDocumentsTool`: tagged template do Prisma parametriza
        // `organizationId` (e os demais valores interpolados) automaticamente
        // — nunca interpolação de string crua — e a query corre na mesma
        // conexão/transação da requisição, então a policy RLS de `leads`
        // continua valendo por trás; o filtro explícito por
        // `organization_id` abaixo é defesa em profundidade, não a única
        // linha de defesa.
        this.prisma.$queryRaw<LeadsByCityRow[]>`
          SELECT city, state, COUNT(*) AS count,
                 COUNT(*) FILTER (WHERE website IS NULL OR website = '') AS "withoutWebsite"
          FROM leads
          WHERE organization_id = ${organizationId}
          GROUP BY city, state
          ORDER BY count DESC
          LIMIT ${TOP_CITIES_LIMIT}
        `,
        // Idem — Prisma não agrupa por data truncada nativamente.
        this.prisma.$queryRaw<LeadsByDayRow[]>`
          SELECT date_trunc('day', discovered_at) AS day,
                 COUNT(*) AS total,
                 COUNT(*) FILTER (WHERE website IS NULL OR website = '') AS "withoutWebsite"
          FROM leads
          WHERE organization_id = ${organizationId} AND discovered_at >= ${dayWindowStart}
          GROUP BY day
          ORDER BY day ASC
        `,
        this.prisma.lead.findMany({
          where: { organizationId },
          orderBy: { discoveredAt: 'desc' },
          take: RECENT_LEADS_LIMIT,
        }),
        this.prisma.scrapeJob.findMany({
          where: { organizationId },
          orderBy: { createdAt: 'desc' },
          take: RECENT_SCRAPE_JOBS_LIMIT,
        }),
      ]);

    const leadsByStatus = toCountMap(leadsByStatusRaw, LEAD_STATUSES);
    const qualified = leadsByStatus.QUALIFIED;
    const disqualified = leadsByStatus.DISQUALIFIED;
    const qualificationRate = qualified + disqualified === 0 ? 0 : qualified / (qualified + disqualified);

    return {
      totalLeads,
      leadsWithoutWebsite,
      qualificationRate,
      leadsByStatus,
      leadsByCity: leadsByCityRows.map((row) => ({
        city: row.city,
        state: row.state,
        count: Number(row.count),
        withoutWebsite: Number(row.withoutWebsite),
      })),
      leadsByDay: leadsByDayRows.map((row) => ({
        date: row.day.toISOString().slice(0, 10),
        total: Number(row.total),
        withoutWebsite: Number(row.withoutWebsite),
      })),
      recentLeads,
      recentScrapeJobs,
    };
  }

  /**
   * Painel de pipeline de negociação (plano
   * pensando-como-empresa-com-agile-beaver.md). Aditivo — mesma disciplina de
   * `getLeadPipelineOverview()`: não altera `getOverview()` nem sua rota,
   * vive em rota própria (`GET .../dashboard/deals`).
   */
  async getDealPipelineOverview(organizationId: string): Promise<DealPipelineOverview> {
    const closingSoonWindowEnd = new Date();
    closingSoonWindowEnd.setDate(closingSoonWindowEnd.getDate() + DEALS_CLOSING_SOON_WINDOW_DAYS);

    const [openValueAgg, dealsByStageRaw, avgSalesCycleRows, dealsClosingSoon, recentlyWonDeals, signatureStatusCounts] =
      await Promise.all([
        this.prisma.deal.aggregate({
          where: { organizationId, deletedAt: null, stage: { notIn: CLOSED_DEAL_STAGES } },
          _sum: { value: true },
        }),
        this.prisma.deal.groupBy({
          by: ['stage'],
          where: { organizationId, deletedAt: null },
          _count: { _all: true },
          _sum: { value: true },
        }),
        // Prisma não calcula `AVG(date - date)` em `groupBy` — mesmo
        // precedente de raw SQL parametrizado de `leadsByCity`/`leadsByDay`
        // acima: tagged template do Prisma parametriza `organizationId`
        // automaticamente, nunca interpolação de string crua.
        this.prisma.$queryRaw<AvgSalesCycleRow[]>`
          SELECT AVG(EXTRACT(EPOCH FROM (actual_close_date - created_at)) / 86400) AS "avgDays"
          FROM deals
          WHERE organization_id = ${organizationId} AND deleted_at IS NULL AND stage = 'WON'
        `,
        this.prisma.deal.findMany({
          where: {
            organizationId,
            deletedAt: null,
            stage: { notIn: CLOSED_DEAL_STAGES },
            expectedCloseDate: { gte: new Date(), lte: closingSoonWindowEnd },
          },
          orderBy: { expectedCloseDate: 'asc' },
          take: DEALS_CLOSING_SOON_LIMIT,
        }),
        this.prisma.deal.findMany({
          where: { organizationId, deletedAt: null, stage: 'WON' },
          orderBy: { actualCloseDate: 'desc' },
          take: RECENTLY_WON_DEALS_LIMIT,
        }),
        this.prisma.dealSignatureRequest.groupBy({
          by: ['status'],
          where: { organizationId },
          _count: { _all: true },
        }),
      ]);

    const dealsByStage = Object.fromEntries(
      DEAL_STAGES.map((stage) => [stage, { count: 0, value: 0 }]),
    ) as Record<DealStage, DealStageBucket>;
    for (const row of dealsByStageRaw as Array<{
      stage: DealStage;
      _count: { _all: number };
      _sum: { value: number | null };
    }>) {
      dealsByStage[row.stage] = { count: row._count._all, value: Number(row._sum.value ?? 0) };
    }

    const won = dealsByStage.WON.count;
    const lost = dealsByStage.LOST.count;
    const winRate = won + lost === 0 ? 0 : won / (won + lost);
    const avgDays = avgSalesCycleRows[0]?.avgDays ?? null;

    const signatureFunnel = (signatureStatusCounts as Array<{ status: string; _count: { _all: number } }>).reduce(
      (acc, row) => {
        acc.sent += row._count._all;
        if (row.status === 'SIGNED') {
          acc.signed += row._count._all;
        }
        return acc;
      },
      { sent: 0, signed: 0 },
    );

    return {
      openValue: Number(openValueAgg._sum.value ?? 0),
      dealsByStage,
      winRate,
      avgSalesCycleDays: avgDays === null ? null : Number(avgDays),
      dealsClosingSoon,
      signatureFunnel,
      recentlyWonDeals,
    };
  }

  /**
   * Trilha C (forecasting, plano pensando-como-empresa-com-agile-beaver.md):
   * pipeline ponderado por probabilidade de estágio + tendência histórica de
   * receita fechada. Aditivo, rota própria (`GET .../dashboard/forecast`).
   *
   * Busca os deals abertos/ganhos inteiros (não agregados no banco) porque a
   * ponderação por `DEAL_STAGE_PROBABILITY` e o bucket por mês truncado
   * precisam rodar em cima da mesma constante TS usada pela AI tool — duas
   * fontes de verdade (SQL bruto + TS) divergiriam com o tempo. Volume por
   * organização (deals abertos + ganhos em 6 meses) é pequeno o bastante pra
   * não justificar agregação no Postgres.
   */
  async getSalesForecast(organizationId: string): Promise<SalesForecast> {
    const wonRevenueWindowStart = new Date();
    wonRevenueWindowStart.setUTCMonth(wonRevenueWindowStart.getUTCMonth() - (WON_REVENUE_TREND_MONTHS - 1));
    wonRevenueWindowStart.setUTCDate(1);
    wonRevenueWindowStart.setUTCHours(0, 0, 0, 0);

    const [openDeals, wonDeals] = await Promise.all([
      this.prisma.deal.findMany({
        where: { organizationId, deletedAt: null, stage: { notIn: CLOSED_DEAL_STAGES } },
        select: { stage: true, value: true, expectedCloseDate: true },
      }),
      this.prisma.deal.findMany({
        where: { organizationId, deletedAt: null, stage: 'WON', actualCloseDate: { gte: wonRevenueWindowStart } },
        select: { value: true, actualCloseDate: true },
      }),
    ]);

    let weightedPipelineValue = 0;
    let unscheduledValue = 0;
    const monthBuckets = new Map<string, ForecastMonthBucket>();
    for (const deal of openDeals) {
      const value = Number(deal.value);
      const weightedValue = value * DEAL_STAGE_PROBABILITY[deal.stage];
      weightedPipelineValue += weightedValue;

      if (deal.expectedCloseDate === null) {
        unscheduledValue += value;
        continue;
      }
      const key = monthKey(deal.expectedCloseDate);
      const bucket = monthBuckets.get(key) ?? { month: key, openValue: 0, weightedValue: 0, dealCount: 0 };
      bucket.openValue += value;
      bucket.weightedValue += weightedValue;
      bucket.dealCount += 1;
      monthBuckets.set(key, bucket);
    }
    const forecastByMonth = [...monthBuckets.values()].sort((a, b) => a.month.localeCompare(b.month));

    const wonRevenueMap = new Map<string, WonRevenueMonthPoint>(
      trailingMonthKeys(WON_REVENUE_TREND_MONTHS, new Date()).map((month) => [
        month,
        { month, wonValue: 0, wonCount: 0 },
      ]),
    );
    for (const deal of wonDeals) {
      if (deal.actualCloseDate === null) continue;
      const key = monthKey(deal.actualCloseDate);
      const point = wonRevenueMap.get(key);
      if (!point) continue; // fora da janela de 6 meses por algum motivo de fuso — ignora, não quebra a série
      point.wonValue += Number(deal.value);
      point.wonCount += 1;
    }

    return {
      weightedPipelineValue,
      unscheduledValue,
      forecastByMonth,
      wonRevenueByMonth: [...wonRevenueMap.values()],
    };
  }
}
