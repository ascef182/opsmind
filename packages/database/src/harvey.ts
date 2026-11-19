import type { HarveyActivity, Prisma, PrismaClient } from '@prisma/client';
import {
  cycleDateFor,
  isWithinWorkingHours,
  type HarveyActivityEvent,
  type HarveyActivityStatus,
  type HarveyActivityType,
  type HarveyPhase,
  type HarveyRationale,
} from '@opsmind/shared-types';
import { getEngineBudgetStatus, startOfUtcMonth } from './revenue-ledger';

// Ponto de verificação e registro de atividades do Harvey, compartilhados por
// apps/api e apps/worker. Só trabalho automático passa pelo checkpoint: pedidos
// manuais de uma pessoa nunca dependem do estado do agente.

type Db = PrismaClient | Prisma.TransactionClient;

export type HarveyStep = 'research' | 'site_analysis' | 'qualification' | 'outreach_draft' | 'send';

export type HarveySkipReason =
  | 'AGENT_PAUSED'
  | 'AGENT_STOPPED'
  | 'RUN_NOT_RUNNING'
  | 'OUTSIDE_WORKING_HOURS'
  | 'GOAL_REACHED'
  | 'BUDGET_EXCEEDED'
  | 'CAMPAIGN_INACTIVE';

export const HARVEY_SKIP_REASON_LABELS: Record<HarveySkipReason, string> = {
  AGENT_PAUSED: 'Harvey pausado',
  AGENT_STOPPED: 'Harvey parado',
  RUN_NOT_RUNNING: 'Nenhum ciclo de trabalho aberto hoje',
  OUTSIDE_WORKING_HOURS: 'Fora do horário de trabalho da campanha',
  GOAL_REACHED: 'Meta diária atingida',
  BUDGET_EXCEEDED: 'Orçamento mensal atingido',
  CAMPAIGN_INACTIVE: 'Campanha arquivada',
};

export type HarveyCheckResult = { ok: true; runId: string | null } | { ok: false; reason: HarveySkipReason };

export interface RunProgress {
  researched: number;
  qualified: number;
  prepared: number;
}

export async function getRunProgress(db: Db, runId: string): Promise<RunProgress> {
  const [researched, qualified, prepared] = await Promise.all([
    db.harveyActivity.count({ where: { runId, type: 'research.lead_found', status: 'SUCCEEDED' } }),
    db.harveyActivity.count({
      where: { runId, type: 'qualification.score', status: 'SUCCEEDED', result: { path: ['qualified'], equals: true } },
    }),
    db.harveyActivity.count({ where: { runId, type: 'outreach.draft', status: 'SUCCEEDED' } }),
  ]);
  return { researched, qualified, prepared };
}

// Gasto do mês atribuível à campanha (buscas e leads dela). Usado só quando a
// campanha tem teto próprio; senão vale o teto do engine da organização.
export async function getCampaignMonthSpendUsd(db: Db, campaignId: string, now: Date = new Date()): Promise<number> {
  const rows = await db.$queryRaw<{ total: Prisma.Decimal | null }[]>`
    SELECT SUM(ce."amount_usd") AS total
    FROM "cost_events" ce
    WHERE ce."occurred_at" >= ${startOfUtcMonth(now)}
      AND (
        ce."scrape_job_id" IN (SELECT "id" FROM "scrape_jobs" WHERE "campaign_id" = ${campaignId})
        OR ce."lead_id" IN (SELECT "id" FROM "leads" WHERE "campaign_id" = ${campaignId})
      )`;
  return Number(rows[0]?.total ?? 0);
}

export async function checkHarveyMayProceed(
  db: Db,
  input: { organizationId: string; campaignId: string | null; step: HarveyStep; now?: Date },
): Promise<HarveyCheckResult> {
  const now = input.now ?? new Date();
  const agent = await db.harveyAgent.findUnique({
    where: { organizationId: input.organizationId },
    select: { controlState: true },
  });
  const control = agent?.controlState ?? 'STOPPED';
  if (control === 'PAUSED') return { ok: false, reason: 'AGENT_PAUSED' };
  if (control === 'STOPPED') return { ok: false, reason: 'AGENT_STOPPED' };
  if (input.step === 'send' || !input.campaignId) return { ok: true, runId: null };

  const campaign = await db.salesCampaign.findFirst({
    where: { id: input.campaignId, organizationId: input.organizationId },
  });
  // Lead cadastrado à mão não pertence a uma busca: segue só o estado do agente,
  // como antes das campanhas de prospecção.
  if (campaign?.kind === 'MANUAL_ENTRY') return { ok: true, runId: null };
  if (!campaign || campaign.kind !== 'STANDARD' || campaign.status !== 'ACTIVE') {
    return { ok: false, reason: 'CAMPAIGN_INACTIVE' };
  }
  if (!isWithinWorkingHours(now, campaign)) return { ok: false, reason: 'OUTSIDE_WORKING_HOURS' };

  const run = await db.harveyRun.findUnique({
    where: { campaignId_cycleDate: { campaignId: campaign.id, cycleDate: new Date(cycleDateFor(now, campaign.timezone)) } },
    select: { id: true, status: true },
  });
  if (!run || run.status !== 'RUNNING') return { ok: false, reason: 'RUN_NOT_RUNNING' };

  if (await isOverBudget(db, input.organizationId, campaign.id, campaign.monthlyBudgetUsd, now)) {
    return { ok: false, reason: 'BUDGET_EXCEEDED' };
  }

  if (input.step === 'research' || input.step === 'outreach_draft') {
    const progress = await getRunProgress(db, run.id);
    const reached =
      input.step === 'research'
        ? progress.researched >= campaign.dailyResearchGoal || progress.qualified >= campaign.dailyQualifiedGoal
        : progress.prepared >= campaign.dailyOutreachGoal;
    if (reached) return { ok: false, reason: 'GOAL_REACHED' };
  }
  return { ok: true, runId: run.id };
}

async function isOverBudget(
  db: Db,
  organizationId: string,
  campaignId: string,
  campaignBudget: Prisma.Decimal | null,
  now: Date,
): Promise<boolean> {
  if ((await getEngineBudgetStatus(db, organizationId, now)).exceeded) return true;
  if (campaignBudget === null) return false;
  return (await getCampaignMonthSpendUsd(db, campaignId, now)) >= Number(campaignBudget);
}

export interface StartActivityInput {
  organizationId: string;
  type: HarveyActivityType;
  phase: HarveyPhase;
  title: string;
  idempotencyKey: string;
  campaignId?: string | null;
  runId?: string | null;
  leadId?: string | null;
  scrapeJobId?: string | null;
  outreachMessageId?: string | null;
  channel?: HarveyActivity['channel'];
  queueJobId?: string | null;
  result?: Record<string, unknown> | null;
  rationale?: HarveyRationale | null;
  actorType?: HarveyActivity['actorType'];
  actorId?: string | null;
}

function activityData(input: StartActivityInput) {
  return {
    organizationId: input.organizationId,
    type: input.type,
    phase: input.phase,
    title: input.title,
    idempotencyKey: input.idempotencyKey,
    campaignId: input.campaignId ?? null,
    runId: input.runId ?? null,
    leadId: input.leadId ?? null,
    scrapeJobId: input.scrapeJobId ?? null,
    outreachMessageId: input.outreachMessageId ?? null,
    channel: input.channel ?? null,
    queueJobId: input.queueJobId ?? null,
    result: (input.result ?? undefined) as Prisma.InputJsonValue | undefined,
    rationale: (input.rationale ?? undefined) as unknown as Prisma.InputJsonValue | undefined,
    actorType: input.actorType ?? 'SYSTEM',
    actorId: input.actorId ?? null,
  };
}

// Idempotente pela chave: uma nova tentativa do mesmo job reaproveita a linha
// (volta a STARTED se ainda não tinha terminado com sucesso).
export async function startHarveyActivity(db: Db, input: StartActivityInput): Promise<HarveyActivity> {
  const existing = await db.harveyActivity.findUnique({
    where: { organizationId_idempotencyKey: { organizationId: input.organizationId, idempotencyKey: input.idempotencyKey } },
  });
  if (existing?.status === 'SUCCEEDED') return existing;
  if (existing) {
    return db.harveyActivity.update({
      where: { id: existing.id },
      data: {
        status: 'STARTED',
        title: input.title,
        startedAt: new Date(),
        finishedAt: null,
        errorMessage: null,
        queueJobId: input.queueJobId ?? existing.queueJobId,
        runId: input.runId ?? existing.runId,
      },
    });
  }
  return db.harveyActivity.create({ data: { ...activityData(input), status: 'STARTED' } });
}

export async function finishHarveyActivity(
  db: Db,
  id: string,
  outcome: {
    status: Exclude<HarveyActivityStatus, 'STARTED'>;
    title?: string;
    result?: Record<string, unknown> | null;
    rationale?: HarveyRationale | null;
    errorMessage?: string | null;
  },
): Promise<HarveyActivity> {
  return db.harveyActivity.update({
    where: { id },
    data: {
      status: outcome.status,
      finishedAt: new Date(),
      ...(outcome.title ? { title: outcome.title } : {}),
      ...(outcome.result !== undefined ? { result: (outcome.result ?? undefined) as Prisma.InputJsonValue } : {}),
      ...(outcome.rationale !== undefined
        ? { rationale: (outcome.rationale ?? undefined) as unknown as Prisma.InputJsonValue }
        : {}),
      ...(outcome.errorMessage !== undefined ? { errorMessage: outcome.errorMessage } : {}),
    },
  });
}

// Evento instantâneo (nasce finalizado). Mesma chave de idempotência → não duplica.
export async function recordHarveyEvent(
  db: Db,
  input: StartActivityInput & { status: Exclude<HarveyActivityStatus, 'STARTED'>; errorMessage?: string | null },
): Promise<HarveyActivity> {
  const now = new Date();
  const { status, errorMessage, ...rest } = input;
  return db.harveyActivity.upsert({
    where: { organizationId_idempotencyKey: { organizationId: input.organizationId, idempotencyKey: input.idempotencyKey } },
    create: { ...activityData(rest), status, startedAt: now, finishedAt: now, errorMessage: errorMessage ?? null },
    update: {},
  });
}

export async function markRunSuccess(db: Db, runId: string | null | undefined): Promise<void> {
  if (!runId) return;
  await db.harveyRun.update({ where: { id: runId }, data: { lastSuccessAt: new Date() } });
}

export async function markRunError(db: Db, runId: string | null | undefined, message: string): Promise<void> {
  if (!runId) return;
  await db.harveyRun.update({
    where: { id: runId },
    data: { lastErrorAt: new Date(), lastErrorMessage: message.slice(0, 500) },
  });
}

export function toHarveyActivityEvent(
  activity: HarveyActivity,
  leadName: string | null = null,
): HarveyActivityEvent {
  return {
    id: activity.id,
    organizationId: activity.organizationId,
    campaignId: activity.campaignId,
    runId: activity.runId,
    type: activity.type as HarveyActivityType,
    phase: activity.phase,
    title: activity.title,
    status: activity.status,
    startedAt: activity.startedAt.toISOString(),
    finishedAt: activity.finishedAt?.toISOString() ?? null,
    leadId: activity.leadId,
    leadName,
    scrapeJobId: activity.scrapeJobId,
    outreachMessageId: activity.outreachMessageId,
    channel: activity.channel,
    result: (activity.result as Record<string, unknown> | null) ?? null,
    rationale: (activity.rationale as HarveyRationale | null) ?? null,
    errorMessage: activity.errorMessage,
    actorType: activity.actorType,
  };
}
