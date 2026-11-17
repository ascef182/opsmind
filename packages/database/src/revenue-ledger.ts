import type { AuditActorType, CostCategory, Prisma } from '@prisma/client';

type StageTransitionClient = Pick<Prisma.TransactionClient, 'pipelineStageTransition'>;
type CostEventClient = Pick<Prisma.TransactionClient, 'costEvent'>;

export interface StageTransitionInput {
  organizationId: string;
  leadId?: string | null;
  dealId?: string | null;
  fromStage: string | null;
  toStage: string | null;
  actorType: AuditActorType;
  actorId?: string | null;
}

// No-op quando o estágio do funil não muda de fato (ex.: OUTREACH_DRAFTED →
// OUTREACH_APPROVED são o mesmo OUTREACH_READY) ou quando o destino não é um
// estágio do funil (`toStage` null).
export async function recordStageTransition(
  client: StageTransitionClient,
  input: StageTransitionInput,
): Promise<void> {
  if (!input.toStage || input.toStage === input.fromStage) return;
  await client.pipelineStageTransition.create({
    data: {
      organizationId: input.organizationId,
      leadId: input.leadId ?? null,
      dealId: input.dealId ?? null,
      fromStage: input.fromStage,
      toStage: input.toStage,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
    },
  });
}

export interface CostEventInput {
  organizationId: string;
  category: CostCategory;
  provider: string;
  operation: string;
  amountUsd: number;
  agent?: string | null;
  quantity?: number;
  leadId?: string | null;
  dealId?: string | null;
  scrapeJobId?: string | null;
  aiRequestId?: string | null;
}

// Custo zero não vira linha: a razão existe para somar gasto, e uma chamada
// gratuita (provider console, cache) só inflaria a contagem.
export async function recordCostEvent(client: CostEventClient, input: CostEventInput): Promise<void> {
  if (!(input.amountUsd > 0)) return;
  await client.costEvent.create({
    data: {
      organizationId: input.organizationId,
      category: input.category,
      provider: input.provider,
      operation: input.operation,
      agent: input.agent ?? null,
      quantity: input.quantity ?? 1,
      amountUsd: input.amountUsd,
      leadId: input.leadId ?? null,
      dealId: input.dealId ?? null,
      scrapeJobId: input.scrapeJobId ?? null,
      aiRequestId: input.aiRequestId ?? null,
    },
  });
}

type EngineBudgetClient = Pick<Prisma.TransactionClient, 'costEvent' | 'organizationRevenueSettings'>;

// Mesmo default da migration para organizações sem configuração gravada.
const DEFAULT_ENGINE_MONTHLY_BUDGET_USD = 50;

export interface EngineBudgetStatus {
  spentUsd: number;
  budgetUsd: number;
  exceeded: boolean;
}

export function startOfUtcMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

// Gasto do mês corrente (UTC) na razão de custos contra o teto do Revenue
// Engine. É o corte das automações que gastam sozinhas (scan diário de
// prospecção, rascunho automático); ações pedidas por um humano seguem os
// orçamentos de IA e scraping de sempre.
export async function getEngineBudgetStatus(
  client: EngineBudgetClient,
  organizationId: string,
  now: Date = new Date(),
): Promise<EngineBudgetStatus> {
  const [spend, settings] = await Promise.all([
    client.costEvent.aggregate({
      where: { organizationId, occurredAt: { gte: startOfUtcMonth(now) } },
      _sum: { amountUsd: true },
    }),
    client.organizationRevenueSettings.findUnique({
      where: { organizationId },
      select: { engineMonthlyBudgetUsd: true },
    }),
  ]);
  const spentUsd = Number(spend._sum.amountUsd ?? 0);
  const budgetUsd = settings ? Number(settings.engineMonthlyBudgetUsd) : DEFAULT_ENGINE_MONTHLY_BUDGET_USD;
  return { spentUsd, budgetUsd, exceeded: spentUsd >= budgetUsd };
}
