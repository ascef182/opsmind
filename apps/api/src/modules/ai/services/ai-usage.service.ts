import { Injectable } from '@nestjs/common';
import type { AIRequestStatus } from '@opsmind/database';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { BudgetService } from './budget.service';

const RECENT_REQUESTS_LIMIT = 20;

export interface DailyUsagePoint {
  date: string;
  cost: number;
  requests: number;
}

export interface UserUsageBreakdown {
  userId: string;
  name: string;
  cost: number;
  requests: number;
  inputTokens: number;
  outputTokens: number;
}

export interface UsageSummary {
  monthSpend: number;
  monthlyBudget: number | null;
  dailySeries: DailyUsagePoint[];
  byUser: UserUsageBreakdown[];
  // PRD §18.6 ("latência média"): agregado do mês inteiro, não por-request
  // (isso já existe em RecentAiRequest/listRecent, via a trace expansível).
  avgLatencyMs: number;
  totalRequests: number;
}

export interface RecentAiRequestToolCall {
  toolName: string;
  isError: boolean;
  input: unknown;
  output: unknown;
}

export interface RecentAiRequest {
  id: string;
  userId: string;
  userName: string;
  model: string;
  status: AIRequestStatus;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  estimatedCost: number;
  createdAt: string;
  toolCalls: RecentAiRequestToolCall[];
}

interface DailyRow {
  day: Date;
  cost: string | number;
  requests: bigint | number;
}

/**
 * Painel de custo/uso de IA (PRD §17, Fase 7; critério de aceitação §18.6).
 * Não introduz tabela nova — `AIRequest`/`AIRequestToolCall` (Fase 3) já
 * guardam tudo, isto é só agregação. `getMonthSpend` continua vindo do
 * contador Redis de `BudgetService` (é a mesma fonte usada pelo corte de
 * orçamento — o painel tem que mostrar exatamente o número que decide o
 * corte, não um recálculo divergente via SQL).
 */
@Injectable()
export class AiUsageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly budgetService: BudgetService,
  ) {}

  async getSummary(organizationId: string): Promise<UsageSummary> {
    const [organization, monthSpend, dailySeries, byUser, latency] = await Promise.all([
      this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId } }),
      this.budgetService.getMonthSpend(organizationId),
      this.getDailySeries(organizationId),
      this.getByUser(organizationId),
      this.getMonthLatency(organizationId),
    ]);

    return {
      monthSpend,
      monthlyBudget: organization.aiMonthlyBudget ? Number(organization.aiMonthlyBudget) : null,
      dailySeries,
      byUser,
      avgLatencyMs: latency.avgLatencyMs,
      totalRequests: latency.totalRequests,
    };
  }

  async listRecent(organizationId: string, limit = RECENT_REQUESTS_LIMIT): Promise<RecentAiRequest[]> {
    const requests = await this.prisma.aIRequest.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { toolCalls: true, user: { select: { name: true } } },
    });

    return requests.map((r) => ({
      id: r.id,
      userId: r.userId,
      userName: r.user.name,
      model: r.model,
      status: r.status,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      latencyMs: r.latencyMs,
      estimatedCost: Number(r.estimatedCost),
      createdAt: r.createdAt.toISOString(),
      toolCalls: r.toolCalls.map((tc) => ({
        toolName: tc.toolName,
        isError: tc.isError,
        input: tc.input,
        output: tc.output,
      })),
    }));
  }

  private async getDailySeries(organizationId: string): Promise<DailyUsagePoint[]> {
    const monthStart = startOfCurrentMonthUtc();
    // Filtro explícito por organização mesmo com RLS ativa (defesa em
    // profundidade, mesmo padrão de SearchDocumentsTool/DocumentsService).
    const rows = await this.prisma.$queryRaw<DailyRow[]>`
      SELECT date_trunc('day', created_at) AS day,
             COALESCE(SUM(estimated_cost), 0) AS cost,
             COUNT(*) AS requests
      FROM ai_requests
      WHERE organization_id = ${organizationId} AND created_at >= ${monthStart}
      GROUP BY day
      ORDER BY day ASC
    `;
    return rows.map((row) => ({
      date: row.day.toISOString().slice(0, 10),
      cost: Number(row.cost),
      requests: Number(row.requests),
    }));
  }

  // Agregado do mês inteiro (não por-dia) — PRD §18.6, "latência média".
  // `_avg.latencyMs` vem `null` do Prisma quando não há nenhuma request no
  // mês (org nova); normalizado pra 0 aqui, não NaN.
  private async getMonthLatency(organizationId: string): Promise<{ avgLatencyMs: number; totalRequests: number }> {
    const monthStart = startOfCurrentMonthUtc();
    const result = await this.prisma.aIRequest.aggregate({
      where: { organizationId, createdAt: { gte: monthStart } },
      _avg: { latencyMs: true },
      _count: { _all: true },
    });
    return {
      avgLatencyMs: result._avg.latencyMs ?? 0,
      totalRequests: result._count._all,
    };
  }

  private async getByUser(organizationId: string): Promise<UserUsageBreakdown[]> {
    const monthStart = startOfCurrentMonthUtc();
    const grouped = await this.prisma.aIRequest.groupBy({
      by: ['userId'],
      where: { organizationId, createdAt: { gte: monthStart } },
      _sum: { estimatedCost: true, inputTokens: true, outputTokens: true },
      _count: { _all: true },
    });

    if (grouped.length === 0) {
      return [];
    }

    const users = await this.prisma.user.findMany({
      where: { id: { in: grouped.map((g) => g.userId) } },
      select: { id: true, name: true },
    });
    const nameById = new Map(users.map((u) => [u.id, u.name]));

    return grouped.map((g) => ({
      userId: g.userId,
      name: nameById.get(g.userId) ?? 'Usuário removido',
      cost: Number(g._sum.estimatedCost ?? 0),
      requests: g._count._all,
      inputTokens: g._sum.inputTokens ?? 0,
      outputTokens: g._sum.outputTokens ?? 0,
    }));
  }
}

function startOfCurrentMonthUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
