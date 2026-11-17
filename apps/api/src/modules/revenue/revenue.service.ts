import { Injectable } from '@nestjs/common';
import type { CostCategory } from '@opsmind/database';
import { leadStatusToPipelineStage, dealStageToPipelineStage, REVENUE_PIPELINE_STAGES } from '@opsmind/shared-types';
import type { RevenuePipelineStage } from '@opsmind/shared-types';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { aggregateCopyPerformance, type CopyPerformanceRow } from './copy-performance';
import {
  computeStageFlows,
  periodWindows,
  ratio,
  type RevenuePeriod,
  type StageFlow,
} from './revenue-metrics';

// Sinais do website profiler que indicam site existente porém fraco.
const WEAK_WEBSITE_SIGNALS = [
  'website.outdated_copyright_year',
  'website.no_ssl',
  'website.no_mobile_viewport',
  'website.no_contact_form',
];

// Janela do cálculo de conversão/tempo por estágio: longa o bastante para um
// ciclo de venda inteiro, curta o bastante para refletir o processo atual.
const FLOW_WINDOW_DAYS = 90;
const COST_SERIES_DAYS = 30;
const MS_PER_DAY = 86_400_000;

export interface KpiValue {
  current: number;
  previous: number;
  // Fase do Revenue Engine que passa a alimentar este número; até lá ele é 0.
  availableFromPhase?: number;
}

export type MoneyByCurrency = Record<string, number>;

export interface RevenueOverview {
  period: RevenuePeriod;
  kpis: {
    discovered: KpiValue;
    withoutWebsite: KpiValue;
    weakWebsite: KpiValue;
    qualified: KpiValue;
    outreachPrepared: KpiValue;
    messagesSent: KpiValue;
    repliesReceived: KpiValue;
    positiveReplies: KpiValue;
    demosRequested: KpiValue;
    previewsGenerated: KpiValue;
    meetingsBooked: KpiValue;
    proposalsSent: KpiValue;
    dealsWon: KpiValue;
    spendUsd: KpiValue;
  };
  revenue: { current: MoneyByCurrency; previous: MoneyByCurrency };
  openPipelineValue: MoneyByCurrency;
  acquisitionCostUsd: { current: number | null; previous: number | null };
}

export interface RevenuePipeline {
  stages: Array<StageFlow & { current: number }>;
  disqualified: number;
  flowWindowDays: number;
}

export interface RevenueCosts {
  period: RevenuePeriod;
  totalUsd: number;
  byCategory: Array<{ category: CostCategory; amountUsd: number }>;
  daily: Array<{ date: string; amountUsd: number }>;
  unitCostsUsd: {
    perDiscoveredLead: number | null;
    perQualifiedLead: number | null;
    perPositiveReply: number | null;
    perWonDeal: number | null;
  };
}

interface Window {
  start: Date;
  end: Date;
}

export interface RevenueCopyPerformance {
  rows: CopyPerformanceRow[];
  // Resposta positiva e pedido de demonstração dependem da classificação de
  // respostas (Fase 4); até lá o relatório mostra respostas em geral.
  positiveRepliesAvailableFrom: string;
}

@Injectable()
export class RevenueService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(organizationId: string, period: RevenuePeriod, now = new Date()): Promise<RevenueOverview> {
    const windows = periodWindows(period, now);
    const [current, previous, openPipelineValue] = await Promise.all([
      this.windowMetrics(organizationId, windows.current),
      this.windowMetrics(organizationId, windows.previous),
      this.openPipelineValue(organizationId),
    ]);

    const kpi = (key: keyof WindowMetrics, availableFromPhase?: number): KpiValue => ({
      current: current[key] as number,
      previous: previous[key] as number,
      ...(availableFromPhase ? { availableFromPhase } : {}),
    });

    return {
      period,
      kpis: {
        discovered: kpi('discovered'),
        withoutWebsite: kpi('withoutWebsite'),
        weakWebsite: kpi('weakWebsite'),
        qualified: kpi('qualified'),
        outreachPrepared: kpi('outreachPrepared'),
        messagesSent: kpi('messagesSent'),
        repliesReceived: kpi('repliesReceived'),
        positiveReplies: kpi('positiveReplies', 4),
        demosRequested: kpi('demosRequested', 4),
        previewsGenerated: kpi('previewsGenerated', 5),
        meetingsBooked: kpi('meetingsBooked'),
        proposalsSent: kpi('proposalsSent'),
        dealsWon: kpi('dealsWon'),
        spendUsd: kpi('spendUsd'),
      },
      revenue: { current: current.revenue, previous: previous.revenue },
      openPipelineValue,
      acquisitionCostUsd: {
        current: ratio(current.spendUsd, current.dealsWon),
        previous: ratio(previous.spendUsd, previous.dealsWon),
      },
    };
  }

  async getPipeline(organizationId: string, now = new Date()): Promise<RevenuePipeline> {
    const since = new Date(now.getTime() - FLOW_WINDOW_DAYS * MS_PER_DAY);
    const [transitions, leadGroups, dealGroups] = await Promise.all([
      this.prisma.pipelineStageTransition.findMany({
        where: { organizationId, occurredAt: { gte: since } },
        select: { leadId: true, dealId: true, toStage: true, occurredAt: true },
      }),
      this.prisma.lead.groupBy({ by: ['status'], where: { organizationId }, _count: { _all: true } }),
      this.prisma.deal.groupBy({
        by: ['stage'],
        where: { organizationId, deletedAt: null },
        _count: { _all: true },
      }),
    ]);

    const current = new Map<RevenuePipelineStage, number>();
    let disqualified = 0;
    for (const group of leadGroups) {
      const stage = leadStatusToPipelineStage(group.status);
      if (stage === 'DISQUALIFIED') {
        disqualified += group._count._all;
      } else if (stage) {
        current.set(stage, (current.get(stage) ?? 0) + group._count._all);
      }
    }
    for (const group of dealGroups) {
      const stage = dealStageToPipelineStage(group.stage);
      current.set(stage, (current.get(stage) ?? 0) + group._count._all);
    }

    const flows = computeStageFlows(transitions);
    return {
      stages: flows.map((flow) => ({ ...flow, current: current.get(flow.stage) ?? 0 })),
      disqualified,
      flowWindowDays: FLOW_WINDOW_DAYS,
    };
  }

  // Rascunhos sem `strategy` são anteriores ao Sales Copy Intelligence e
  // ficam de fora: não dá para atribuir resultado a uma abordagem.
  async getCopyPerformance(organizationId: string): Promise<RevenueCopyPerformance> {
    const messages = await this.prisma.outreachMessage.findMany({
      where: { organizationId, strategy: { not: null } },
      select: {
        leadId: true,
        strategy: true,
        channel: true,
        promptVersion: true,
        status: true,
        body: true,
        originalBody: true,
        approvedAt: true,
        sentAt: true,
        repliedAt: true,
      },
    });
    const sentLeadIds = [...new Set(messages.filter((m) => m.sentAt).map((m) => m.leadId))];
    const transitions =
      sentLeadIds.length === 0
        ? []
        : await this.prisma.pipelineStageTransition.findMany({
            where: { organizationId, leadId: { in: sentLeadIds } },
            select: { leadId: true, toStage: true },
          });
    const stagesReachedByLead = new Map<string, Set<string>>();
    for (const transition of transitions) {
      if (!transition.leadId) continue;
      const reached = stagesReachedByLead.get(transition.leadId) ?? new Set<string>();
      reached.add(transition.toStage);
      stagesReachedByLead.set(transition.leadId, reached);
    }
    return {
      rows: aggregateCopyPerformance(
        messages.map((m) => ({ ...m, strategy: m.strategy! })),
        stagesReachedByLead,
      ),
      positiveRepliesAvailableFrom: 'Fase 4',
    };
  }

  async getCosts(organizationId: string, period: RevenuePeriod, now = new Date()): Promise<RevenueCosts> {
    const window = periodWindows(period, now).current;
    const seriesStart = new Date(now.getTime() - COST_SERIES_DAYS * MS_PER_DAY);
    const [byCategory, seriesEvents, metrics] = await Promise.all([
      this.prisma.costEvent.groupBy({
        by: ['category'],
        where: { organizationId, occurredAt: { gte: window.start, lt: window.end } },
        _sum: { amountUsd: true },
      }),
      this.prisma.costEvent.findMany({
        where: { organizationId, occurredAt: { gte: seriesStart, lt: now } },
        select: { occurredAt: true, amountUsd: true },
      }),
      this.windowMetrics(organizationId, window),
    ]);

    const daily = new Map<string, number>();
    for (let day = 0; day < COST_SERIES_DAYS; day++) {
      daily.set(new Date(seriesStart.getTime() + (day + 1) * MS_PER_DAY).toISOString().slice(0, 10), 0);
    }
    for (const event of seriesEvents) {
      const key = event.occurredAt.toISOString().slice(0, 10);
      daily.set(key, (daily.get(key) ?? 0) + Number(event.amountUsd));
    }

    const totalUsd = metrics.spendUsd;
    return {
      period,
      totalUsd,
      byCategory: byCategory
        .map((group) => ({ category: group.category, amountUsd: Number(group._sum.amountUsd ?? 0) }))
        .sort((a, b) => b.amountUsd - a.amountUsd),
      daily: [...daily.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, amountUsd]) => ({ date, amountUsd })),
      unitCostsUsd: {
        perDiscoveredLead: ratio(totalUsd, metrics.discovered),
        perQualifiedLead: ratio(totalUsd, metrics.qualified),
        perPositiveReply: ratio(totalUsd, metrics.positiveReplies),
        perWonDeal: ratio(totalUsd, metrics.dealsWon),
      },
    };
  }

  private async windowMetrics(organizationId: string, window: Window): Promise<WindowMetrics> {
    const range = { gte: window.start, lt: window.end };
    const enteredStage = (stage: RevenuePipelineStage) =>
      this.prisma.pipelineStageTransition.count({ where: { organizationId, toStage: stage, occurredAt: range } });

    const [
      discovered,
      withoutWebsite,
      weakWebsiteLeads,
      qualified,
      outreachPrepared,
      messagesSent,
      repliesReceived,
      demosRequested,
      previewsGenerated,
      meetingsBooked,
      proposalsSent,
      dealsWon,
      wonDeals,
      spend,
    ] = await Promise.all([
      this.prisma.lead.count({ where: { organizationId, discoveredAt: range } }),
      this.prisma.lead.count({ where: { organizationId, discoveredAt: range, website: null } }),
      this.prisma.leadSignal.findMany({
        where: { organizationId, observedAt: range, signalCode: { in: WEAK_WEBSITE_SIGNALS } },
        select: { leadId: true },
        distinct: ['leadId'],
      }),
      enteredStage('QUALIFIED'),
      this.prisma.outreachMessage.count({ where: { organizationId, createdAt: range } }),
      this.prisma.outreachMessage.count({ where: { organizationId, sentAt: range } }),
      this.prisma.outreachMessage.count({ where: { organizationId, repliedAt: range } }),
      enteredStage('DEMO_REQUESTED'),
      enteredStage('PREVIEW_READY'),
      this.prisma.meeting.count({ where: { organizationId, createdAt: range, canceledAt: null } }),
      enteredStage('PROPOSAL_SENT'),
      enteredStage('WON'),
      this.prisma.deal.findMany({
        where: { organizationId, deletedAt: null, stage: 'WON', actualCloseDate: range },
        select: { value: true, currency: true },
      }),
      this.prisma.costEvent.aggregate({
        where: { organizationId, occurredAt: range },
        _sum: { amountUsd: true },
      }),
    ]);

    return {
      discovered,
      withoutWebsite,
      weakWebsite: weakWebsiteLeads.length,
      qualified,
      outreachPrepared,
      messagesSent,
      repliesReceived,
      // Classificação de respostas chega na Fase 4.
      positiveReplies: 0,
      demosRequested,
      previewsGenerated,
      meetingsBooked,
      proposalsSent,
      dealsWon,
      spendUsd: Number(spend._sum.amountUsd ?? 0),
      revenue: sumByCurrency(wonDeals),
    };
  }

  private async openPipelineValue(organizationId: string): Promise<MoneyByCurrency> {
    const deals = await this.prisma.deal.findMany({
      where: { organizationId, deletedAt: null, stage: { notIn: ['WON', 'LOST'] } },
      select: { value: true, currency: true },
    });
    return sumByCurrency(deals);
  }
}

interface WindowMetrics {
  discovered: number;
  withoutWebsite: number;
  weakWebsite: number;
  qualified: number;
  outreachPrepared: number;
  messagesSent: number;
  repliesReceived: number;
  positiveReplies: number;
  demosRequested: number;
  previewsGenerated: number;
  meetingsBooked: number;
  proposalsSent: number;
  dealsWon: number;
  spendUsd: number;
  revenue: MoneyByCurrency;
}

// Nunca converte moeda: receita em BRL e USD ficam separadas (a precificação
// dos dois mercados é independente, ver plano do Revenue Engine).
function sumByCurrency(deals: Array<{ value: unknown; currency: string }>): MoneyByCurrency {
  const totals: MoneyByCurrency = {};
  for (const deal of deals) {
    totals[deal.currency] = (totals[deal.currency] ?? 0) + Number(deal.value);
  }
  return totals;
}

export const REVENUE_PIPELINE_STAGE_COUNT = REVENUE_PIPELINE_STAGES.length;
