import type { HarveyActivity, HarveyRun, Prisma, PrismaClient, SalesCampaign } from '@opsmind/database';
import { checkHarveyMayProceed, getRunProgress, recordHarveyEvent } from '@opsmind/database';
import {
  LEAD_SCRAPE_QUEUE,
  OUTREACH_AUTODRAFT_QUEUE,
  WEBSITE_PROFILE_QUEUE,
  cycleDateFor,
  isWithinWorkingHours,
  resolveAutodraftChannel,
  type HarveyRunEndReason,
  type LeadScrapeJobData,
  type OutreachAutodraftJobData,
  type OutreachSendReconcileJobData,
  type WebsiteProfileJobData,
} from '@opsmind/shared-types';
import * as Sentry from '@sentry/node';
import { withTenantContext } from './tenant-context';
import { publishActivities, type HarveyPublish } from './harvey-events';

// Orquestrador do Harvey: um tick por minuto (job scheduler do BullMQ, único
// entre réplicas) reconcilia o banco e enfileira os jobs que já existem. Nada
// aqui chama IA. Ver docs/superpowers/specs/2026-11-17-harvey-fase1-controle-design.md §6.3.

export const ORPHAN_WITHOUT_JOB_MS = 15 * 60_000;

// O BullMQ não aceita ":" em jobId customizado.
export function harveyScrapeJobId(scrapeJobId: string): string {
  return `harvey-scrape-${scrapeJobId}`;
}
export const ORPHAN_GRACE_MS = 2 * 60_000;
export const SENDING_STUCK_MS = 10 * 60_000;
const MAX_PROFILES_PER_TICK = 5;
// O tick consulta o BullMQ (jobs vivos) dentro da transação; o padrão de 5s
// do Prisma não basta para uma organização com fila acumulada.
const TICK_TRANSACTION_TIMEOUT_MS = 30_000;
const MAX_DRAFTS_PER_TICK = 5;
// Reconciliação de SEND_UNKNOWN: no máximo uma tentativa por hora por mensagem,
// dentro da janela de idempotência do provedor (23h).
const RECONCILE_RETRY_SECONDS = 3600;
const RECONCILE_WINDOW_MS = 23 * 3_600_000;

interface QueueLike<T> {
  add(name: string, data: T, opts?: Record<string, unknown>): Promise<unknown>;
}

export interface HarveyTickDeps {
  prisma: PrismaClient;
  kv: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<unknown>;
    // SET NX com expiração: true só para quem gravou primeiro.
    claim(key: string, ttlSeconds: number): Promise<boolean>;
  };
  queues: {
    leadScrape: QueueLike<LeadScrapeJobData>;
    websiteProfile: QueueLike<WebsiteProfileJobData>;
    outreachAutodraft: QueueLike<OutreachAutodraftJobData>;
    sendReconcile: QueueLike<OutreachSendReconcileJobData>;
  };
  // Se o job BullMQ dono de uma atividade ainda está vivo (esperando ou rodando).
  isQueueJobAlive: (queueName: string, jobId: string) => Promise<boolean>;
  publish?: HarveyPublish;
  now?: () => Date;
}

export interface HarveyTickSummary {
  organizations: number;
  skippedLocked: number;
  runsOpened: number;
  runsClosed: number;
  scrapeJobs: number;
  profiles: number;
  drafts: number;
  orphans: number;
  uncertainSends: number;
}

type Intent =
  | { kind: 'scrape'; data: LeadScrapeJobData; scrapeJobId: string }
  | { kind: 'profile'; data: WebsiteProfileJobData }
  | { kind: 'draft'; data: OutreachAutodraftJobData }
  | { kind: 'reconcile'; data: OutreachSendReconcileJobData };

interface OrgOutcome {
  locked: boolean;
  intents: Intent[];
  activities: { activity: HarveyActivity; leadName?: string | null }[];
  summary: Omit<HarveyTickSummary, 'organizations' | 'skippedLocked' | 'scrapeJobs' | 'profiles' | 'drafts'>;
  statusSignature: string;
}

const QUEUE_BY_ACTIVITY: Record<string, string> = {
  'research.search': LEAD_SCRAPE_QUEUE,
  'research.site_analysis': WEBSITE_PROFILE_QUEUE,
  'outreach.draft': OUTREACH_AUTODRAFT_QUEUE,
};

export async function runHarveyTick(deps: HarveyTickDeps, organizationId?: string): Promise<HarveyTickSummary> {
  const now = deps.now?.() ?? new Date();
  const agents = await deps.prisma.harveyAgent.findMany({
    where: organizationId ? { organizationId } : {},
    select: { organizationId: true },
  });
  const total: HarveyTickSummary = {
    organizations: agents.length,
    skippedLocked: 0,
    runsOpened: 0,
    runsClosed: 0,
    scrapeJobs: 0,
    profiles: 0,
    drafts: 0,
    orphans: 0,
    uncertainSends: 0,
  };

  for (const { organizationId: orgId } of agents) {
    try {
      const outcome = await withTenantContext(
        deps.prisma,
        orgId,
        (tx) => tickOrganization(tx, deps, orgId, now),
        TICK_TRANSACTION_TIMEOUT_MS,
      );
      if (!outcome.locked) {
        total.skippedLocked += 1;
        continue;
      }
      total.runsOpened += outcome.summary.runsOpened;
      total.runsClosed += outcome.summary.runsClosed;
      total.orphans += outcome.summary.orphans;
      total.uncertainSends += outcome.summary.uncertainSends;
      await publishActivities(deps.publish, outcome.activities);
      for (const intent of outcome.intents) {
        try {
          await enqueue(deps, intent);
        } catch (error) {
          // Uma busca que não entrou na fila é recuperada por recoverStuckSearches.
          Sentry.captureException(error, { extra: { organizationId: orgId, intent: intent.kind } });
          console.error(`[harvey] falha ao enfileirar ${intent.kind}:`, error);
          continue;
        }
        if (intent.kind === 'scrape') total.scrapeJobs += 1;
        if (intent.kind === 'profile') total.profiles += 1;
        if (intent.kind === 'draft') total.drafts += 1;
      }
      await publishStatusIfChanged(deps, orgId, outcome.statusSignature);
    } catch (error) {
      Sentry.captureException(error, { extra: { organizationId: orgId, phase: 'harvey-tick' } });
    }
  }
  return total;
}

// Depois do commit. Deduplicação do BullMQ: o mesmo lead não entra duas vezes
// enquanto o job anterior existir; a busca tem jobId fixo.
async function enqueue(deps: HarveyTickDeps, intent: Intent): Promise<void> {
  switch (intent.kind) {
    case 'scrape':
      await deps.queues.leadScrape.add('scrape', intent.data, { jobId: harveyScrapeJobId(intent.scrapeJobId) });
      return;
    case 'profile':
      await deps.queues.websiteProfile.add('investigate', intent.data, {
        deduplication: { id: `website-profile:${intent.data.leadId}` },
      });
      return;
    case 'draft':
      await deps.queues.outreachAutodraft.add('autodraft', intent.data, {
        deduplication: { id: `outreach-autodraft:${intent.data.leadId}` },
      });
      return;
    case 'reconcile':
      await deps.queues.sendReconcile.add('reconcile', intent.data, {
        deduplication: { id: `reconcile:${intent.data.messageId}` },
      });
  }
}

async function publishStatusIfChanged(deps: HarveyTickDeps, orgId: string, signature: string): Promise<void> {
  if (!deps.publish) return;
  const key = `harvey:status:${orgId}`;
  if ((await deps.kv.get(key)) === signature) return;
  await deps.kv.set(key, signature);
  await deps.publish(orgId, { kind: 'status.changed' });
}

async function tickOrganization(
  tx: Prisma.TransactionClient,
  deps: HarveyTickDeps,
  orgId: string,
  now: Date,
): Promise<OrgOutcome> {
  const outcome: OrgOutcome = {
    locked: false,
    intents: [],
    activities: [],
    summary: { runsOpened: 0, runsClosed: 0, orphans: 0, uncertainSends: 0 },
    statusSignature: '',
  };
  // Mesma trava dos comandos da API: um tick por organização por vez.
  const [lock] = await tx.$queryRaw<{ locked: boolean }[]>`
    SELECT pg_try_advisory_xact_lock(hashtext(${`harvey:${orgId}`})) AS locked`;
  if (!lock?.locked) return outcome;
  outcome.locked = true;

  const agent = await tx.harveyAgent.findUnique({ where: { organizationId: orgId } });
  const control = agent?.controlState ?? 'STOPPED';

  await recoverOrphans(tx, deps, orgId, now, outcome);
  await recoverStuckSearches(tx, deps, orgId, now, outcome);
  await flagStuckSends(tx, orgId, now, outcome);
  await scheduleReconciliations(tx, deps, orgId, now, outcome);

  const campaigns = await tx.salesCampaign.findMany({ where: { organizationId: orgId, kind: 'STANDARD', status: 'ACTIVE' } });
  const signatureParts: string[] = [control];
  for (const campaign of campaigns) {
    const run = await reconcileRun(tx, orgId, campaign, control, now, outcome);
    signatureParts.push(`${campaign.id}:${run?.status ?? '-'}`);
    if (run?.status === 'RUNNING') await planWork(tx, orgId, campaign, run, now, outcome);
  }
  const inProgress = await tx.harveyActivity.count({ where: { organizationId: orgId, status: 'STARTED' } });
  signatureParts.push(`busy:${inProgress > 0}`);
  outcome.statusSignature = signatureParts.join('|');
  return outcome;
}

// Fecha ciclos de dias anteriores, alinha os ciclos com o comando atual e
// abre/fecha o ciclo de hoje conforme o horário. Devolve o ciclo de hoje.
async function reconcileRun(
  tx: Prisma.TransactionClient,
  orgId: string,
  campaign: SalesCampaign,
  control: string,
  now: Date,
  outcome: OrgOutcome,
): Promise<HarveyRun | null> {
  const cycleDate = new Date(cycleDateFor(now, campaign.timezone));
  const stale = await tx.harveyRun.findMany({
    where: { campaignId: campaign.id, status: { in: ['RUNNING', 'PAUSED'] }, cycleDate: { lt: cycleDate } },
  });
  for (const run of stale) {
    await closeRun(tx, run, run.status === 'PAUSED' ? 'DAY_ENDED_WHILE_PAUSED' : 'HOURS_ENDED', 'COMPLETED', now, outcome);
  }

  let run = await tx.harveyRun.findUnique({ where: { campaignId_cycleDate: { campaignId: campaign.id, cycleDate } } });

  // Defesa contra corrida com um comando: o ciclo sempre segue o comando gravado.
  if (control === 'STOPPED') {
    if (run && (run.status === 'RUNNING' || run.status === 'PAUSED')) {
      run = await closeRun(tx, run, 'STOPPED_BY_USER', 'STOPPED', now, outcome);
    }
    return run;
  }
  if (control === 'PAUSED') {
    if (run?.status === 'RUNNING') {
      run = await tx.harveyRun.update({ where: { id: run.id }, data: { status: 'PAUSED', pausedAt: now } });
    }
    return run;
  }
  if (run?.status === 'PAUSED') {
    const pausedMs = run.pausedAt ? BigInt(now.getTime() - run.pausedAt.getTime()) : 0n;
    run = await tx.harveyRun.update({
      where: { id: run.id },
      data: { status: 'RUNNING', pausedAt: null, pausedMs: { increment: pausedMs } },
    });
  }

  const within = isWithinWorkingHours(now, campaign);
  const reopen =
    run?.status === 'COMPLETED' &&
    within &&
    ((run.endReason === 'GOALS_MET' && goalsRaised(run, campaign)) ||
      (run.endReason === 'NO_WORK_AVAILABLE' && (await hasNewWork(tx, orgId, campaign, run, now))));
  if (run && reopen) {
    run = await tx.harveyRun.update({
      where: { id: run.id },
      data: { status: 'RUNNING', endReason: null, endedAt: null, goals: goalsOf(campaign) },
    });
    outcome.activities.push({
      activity: await recordHarveyEvent(tx, {
        organizationId: orgId,
        type: 'run.resumed',
        phase: 'CONTROL',
        title: `Novo trabalho disponível: Harvey voltou a trabalhar na campanha ${campaign.name}`,
        idempotencyKey: `run.resumed:${run.id}:${now.getTime()}`,
        status: 'SUCCEEDED',
        runId: run.id,
        campaignId: campaign.id,
      }),
    });
  }
  if (!run && within) {
    const created = await tx.harveyRun.createMany({
      data: [
        {
          organizationId: orgId,
          campaignId: campaign.id,
          cycleDate,
          status: 'RUNNING',
          startedAt: now,
          goals: goalsOf(campaign),
        },
      ],
      skipDuplicates: true,
    });
    run = await tx.harveyRun.findUnique({ where: { campaignId_cycleDate: { campaignId: campaign.id, cycleDate } } });
    if (created.count > 0 && run) {
      outcome.summary.runsOpened += 1;
      outcome.activities.push({
        activity: await recordHarveyEvent(tx, {
          organizationId: orgId,
          type: 'run.started',
          phase: 'CONTROL',
          title: `Harvey começou o dia na campanha ${campaign.name}`,
          idempotencyKey: `run.started:${run.id}`,
          status: 'SUCCEEDED',
          runId: run.id,
          campaignId: campaign.id,
          result: { goals: run.goals as Record<string, number> },
        }),
      });
    }
  } else if (run?.status === 'RUNNING') {
    // Metas do dia acompanham a configuração atual da campanha.
    run = await tx.harveyRun.update({
      where: { id: run.id },
      data: { goals: goalsOf(campaign) },
    });
    if (!within) run = await closeRun(tx, run, 'HOURS_ENDED', 'COMPLETED', now, outcome);
  }
  return run;
}

function goalsOf(campaign: SalesCampaign) {
  return {
    research: campaign.dailyResearchGoal,
    qualified: campaign.dailyQualifiedGoal,
    outreach: campaign.dailyOutreachGoal,
  };
}

function goalsRaised(run: HarveyRun, campaign: SalesCampaign): boolean {
  const before = (run.goals ?? {}) as Partial<ReturnType<typeof goalsOf>>;
  const after = goalsOf(campaign);
  return (
    after.research > (before.research ?? 0) ||
    after.qualified > (before.qualified ?? 0) ||
    after.outreach > (before.outreach ?? 0)
  );
}

async function closeRun(
  tx: Prisma.TransactionClient,
  run: HarveyRun,
  reason: HarveyRunEndReason,
  status: 'COMPLETED' | 'STOPPED',
  now: Date,
  outcome: OrgOutcome,
): Promise<HarveyRun> {
  const pausedMs = run.pausedAt ? BigInt(now.getTime() - run.pausedAt.getTime()) : 0n;
  const { count } = await tx.harveyRun.updateMany({
    where: { id: run.id, status: { in: ['RUNNING', 'PAUSED'] } },
    data: { status, endReason: reason, endedAt: now, pausedAt: null, pausedMs: { increment: pausedMs } },
  });
  const closed = await tx.harveyRun.findUniqueOrThrow({ where: { id: run.id } });
  if (count === 0) return closed;
  outcome.summary.runsClosed += 1;
  outcome.activities.push({
    activity: await recordHarveyEvent(tx, {
      organizationId: run.organizationId,
      type: status === 'STOPPED' ? 'run.stopped' : 'run.completed',
      phase: 'CONTROL',
      title: RUN_END_TITLES[reason],
      idempotencyKey: `run.${status === 'STOPPED' ? 'stopped' : 'completed'}:${run.id}:${now.getTime()}`,
      status: 'SUCCEEDED',
      runId: run.id,
      campaignId: run.campaignId,
      result: { reason, progress: { ...(await getRunProgress(tx, run.id)) } },
    }),
  });
  return closed;
}

const RUN_END_TITLES: Record<HarveyRunEndReason, string> = {
  GOALS_MET: 'Ciclo concluído: metas do dia atingidas',
  HOURS_ENDED: 'Ciclo concluído: fim do horário de trabalho',
  STOPPED_BY_USER: 'Ciclo encerrado: Harvey parado',
  NO_WORK_AVAILABLE: 'Ciclo concluído: sem mais trabalho disponível hoje',
  BUDGET_EXCEEDED: 'Ciclo concluído: orçamento do mês atingido',
  DAY_ENDED_WHILE_PAUSED: 'Ciclo encerrado: o dia terminou com o Harvey pausado',
  CAMPAIGN_PAUSED: 'Ciclo encerrado: campanha pausada',
  CAMPAIGN_CLOSED: 'Ciclo encerrado: campanha finalizada ou arquivada',
};

// Decide o trabalho do ciclo: próxima busca, leads pendentes de análise de
// site e de rascunho, e conclusão. Tudo a partir do estado do banco, o que faz
// o Retomar continuar exatamente de onde parou.
async function planWork(
  tx: Prisma.TransactionClient,
  orgId: string,
  campaign: SalesCampaign,
  run: HarveyRun,
  now: Date,
  outcome: OrgOutcome,
): Promise<void> {
  const research = await checkHarveyMayProceed(tx, {
    organizationId: orgId,
    campaignId: campaign.id,
    step: 'research',
    now,
  });
  const searchInFlight = await tx.scrapeJob.count({
    where: { harveyRunId: run.id, status: { in: ['QUEUED', 'RUNNING'] } },
  });
  let targetsLeft = true;
  if (research.ok && searchInFlight === 0) {
    targetsLeft = await scheduleResearch(tx, orgId, campaign, run, now, outcome);
  }

  // Análise e rascunho seguem as mesmas travas sem a meta de pesquisa: com o
  // orçamento estourado não se enfileira nada (evita SKIPPED a cada minuto).
  const followUp = await checkHarveyMayProceed(tx, {
    organizationId: orgId,
    campaignId: campaign.id,
    step: 'site_analysis',
    now,
  });
  const progress = await getRunProgress(tx, run.id);
  const profileLeads = !followUp.ok ? [] : await tx.lead.findMany({
    where: {
      ...pendingLeadWhere(orgId, campaign.id),
      website: { not: null },
      signals: { none: {} },
      harveyActivities: { none: nonSkippedActivity('research.site_analysis') },
    },
    orderBy: { createdAt: 'asc' },
    take: MAX_PROFILES_PER_TICK,
  });
  for (const lead of profileLeads) {
    outcome.intents.push({
      kind: 'profile',
      data: { organizationId: orgId, leadId: lead.id, actorType: 'SYSTEM', trigger: 'AUTOMATIC' },
    });
  }

  const draftsInFlight = await tx.harveyActivity.count({
    where: { runId: run.id, type: 'outreach.draft', status: 'STARTED' },
  });
  const draftBudget = Math.min(MAX_DRAFTS_PER_TICK, campaign.dailyOutreachGoal - progress.prepared - draftsInFlight);
  const draftLeads = !followUp.ok ? [] : await tx.lead.findMany({
    where: {
      ...pendingLeadWhere(orgId, campaign.id),
      harveyActivities: { none: nonSkippedActivity('outreach.draft') },
      OR: [
        { website: null },
        { signals: { some: {} } },
        { harveyActivities: { some: nonSkippedActivity('research.site_analysis') } },
      ],
    },
    orderBy: { score: 'desc' },
    take: Math.max(0, draftBudget) + 10,
  });
  let draftable = 0;
  for (const lead of draftLeads) {
    const channel = resolveAutodraftChannel(lead);
    if (!channel) continue;
    draftable += 1;
    if (draftable > draftBudget) continue;
    outcome.intents.push({
      kind: 'draft',
      data: { organizationId: orgId, leadId: lead.id, channel, trigger: 'AUTOMATIC' },
    });
  }

  const busy =
    searchInFlight > 0 ||
    outcome.intents.some((intent) => intent.kind === 'scrape') ||
    (await tx.harveyActivity.count({ where: { runId: run.id, status: 'STARTED' } })) > 0;
  const researchDone = !research.ok || !targetsLeft;
  const draftsDone = progress.prepared >= campaign.dailyOutreachGoal || (draftable === 0 && profileLeads.length === 0);
  if (!busy && researchDone && draftsDone) {
    const reason: HarveyRunEndReason =
      (!research.ok && research.reason === 'BUDGET_EXCEEDED') || (!followUp.ok && followUp.reason === 'BUDGET_EXCEEDED')
        ? 'BUDGET_EXCEEDED'
        : !research.ok && research.reason === 'GOAL_REACHED'
          ? 'GOALS_MET'
          : 'NO_WORK_AVAILABLE';
    await closeRun(tx, run, reason, 'COMPLETED', now, outcome);
  }
}

function pendingLeadWhere(orgId: string, campaignId: string): Prisma.LeadWhereInput {
  // Duplicata confirmada por uma pessoa sai do trabalho automático.
  return { organizationId: orgId, campaignId, status: 'QUALIFIED', duplicateOfLeadId: null, outreachMessages: { none: {} } };
}

// Uma tentativa automática por lead: só uma pausa (chave `:skipped:`) não conta.
function nonSkippedActivity(type: string): Prisma.HarveyActivityWhereInput {
  return { type, NOT: { idempotencyKey: { contains: ':skipped:' } } };
}

// Alvos ativos da campanha que ainda não rodaram neste ciclo e já passaram do
// cooldown, do que está há mais tempo sem rodar para o mais recente.
async function findAvailableTargets(
  tx: Prisma.TransactionClient,
  orgId: string,
  campaignId: string,
  runId: string,
  now: Date,
) {
  const targets = await tx.prospectingTarget.findMany({
    where: { organizationId: orgId, campaignId, isActive: true },
    include: {
      scrapeJobs: {
        where: { status: { in: ['QUEUED', 'RUNNING', 'COMPLETED'] } },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { createdAt: true },
      },
    },
  });
  const usedThisRun = new Set(
    (
      await tx.scrapeJob.findMany({
        where: { harveyRunId: runId, status: { not: 'CANCELLED' } },
        select: { prospectingTargetId: true },
      })
    ).map((job) => job.prospectingTargetId),
  );
  return targets
    .filter((target) => !usedThisRun.has(target.id))
    .filter((target) => {
      const last = target.scrapeJobs[0]?.createdAt;
      return !last || now.getTime() - last.getTime() >= target.cooldownDays * 86_400_000;
    })
    .sort((a, b) => (a.scrapeJobs[0]?.createdAt.getTime() ?? 0) - (b.scrapeJobs[0]?.createdAt.getTime() ?? 0));
}

// Há trabalho novo para um ciclo que fechou por falta dele (ex.: alvo cadastrado
// depois). Mesmas condições de planWork, para não abrir e fechar em loop.
async function hasNewWork(
  tx: Prisma.TransactionClient,
  orgId: string,
  campaign: SalesCampaign,
  run: HarveyRun,
  now: Date,
): Promise<boolean> {
  if ((await findAvailableTargets(tx, orgId, campaign.id, run.id, now)).length > 0) return true;
  const pending = await tx.lead.count({
    where: {
      ...pendingLeadWhere(orgId, campaign.id),
      OR: [
        { website: { not: null }, signals: { none: {} }, harveyActivities: { none: nonSkippedActivity('research.site_analysis') } },
        { harveyActivities: { none: nonSkippedActivity('outreach.draft') } },
      ],
    },
  });
  return pending > 0;
}

// Cria a próxima busca do ciclo no alvo que está há mais tempo sem rodar,
// respeitando o cooldown. Devolve false quando não há alvo disponível.
async function scheduleResearch(
  tx: Prisma.TransactionClient,
  orgId: string,
  campaign: SalesCampaign,
  run: HarveyRun,
  now: Date,
  outcome: OrgOutcome,
): Promise<boolean> {
  const target = (await findAvailableTargets(tx, orgId, campaign.id, run.id, now))[0];
  if (!target) return false;

  const progress = await getRunProgress(tx, run.id);
  const remaining = Math.max(1, campaign.dailyResearchGoal - progress.researched);
  try {
    const job = await tx.scrapeJob.create({
      data: {
        organizationId: orgId,
        campaignId: campaign.id,
        prospectingTargetId: target.id,
        harveyRunId: run.id,
        sourceType: target.sourceType,
        city: target.city,
        state: target.state,
        businessType: target.businessType,
        onlyWithoutWebsite: target.onlyWithoutWebsite,
        limit: Math.min(target.limit, remaining),
        status: 'QUEUED',
        actorType: 'SYSTEM',
        actorId: null,
      },
    });
    await tx.auditLog.create({
      data: {
        organizationId: orgId,
        actorType: 'SYSTEM',
        actorId: null,
        action: 'scrape_job.created',
        resource: `ScrapeJob:${job.id}`,
        metadata: { trigger: 'harvey', harveyRunId: run.id, prospectingTargetId: target.id },
      },
    });
    outcome.intents.push({
      kind: 'scrape',
      scrapeJobId: job.id,
      data: { organizationId: orgId, scrapeJobId: job.id, actorType: 'SYSTEM' },
    });
  } catch (error) {
    // Outra réplica criou a mesma busca (índice único): nada a fazer.
    if ((error as { code?: string }).code !== 'P2002') throw error;
  }
  return true;
}

// Atividades STARTED cujo job morreu (reinício do worker/API) viram FAILED,
// para o estado exibido nunca mentir.
async function recoverOrphans(
  tx: Prisma.TransactionClient,
  deps: HarveyTickDeps,
  orgId: string,
  now: Date,
  outcome: OrgOutcome,
): Promise<void> {
  const open = await tx.harveyActivity.findMany({
    where: { organizationId: orgId, status: 'STARTED', startedAt: { lt: new Date(now.getTime() - ORPHAN_GRACE_MS) } },
    take: 50,
  });
  for (const activity of open) {
    const queueName = QUEUE_BY_ACTIVITY[activity.type];
    const alive =
      activity.queueJobId && queueName
        ? await deps.isQueueJobAlive(queueName, activity.queueJobId)
        : now.getTime() - activity.startedAt.getTime() < ORPHAN_WITHOUT_JOB_MS;
    if (alive) continue;
    const { count } = await tx.harveyActivity.updateMany({
      where: { id: activity.id, status: 'STARTED' },
      data: { status: 'FAILED', finishedAt: now, errorMessage: 'Interrompida (o processo foi reiniciado ou o job se perdeu).' },
    });
    if (count === 0) continue;
    outcome.summary.orphans += 1;
    outcome.activities.push({
      activity: await tx.harveyActivity.findUniqueOrThrow({ where: { id: activity.id } }),
    });
  }
}

// Busca do Harvey parada em QUEUED/RUNNING sem job vivo no BullMQ (reinício do
// worker ou falha ao enfileirar): vira FAILED para liberar a próxima busca.
async function recoverStuckSearches(
  tx: Prisma.TransactionClient,
  deps: HarveyTickDeps,
  orgId: string,
  now: Date,
  outcome: OrgOutcome,
): Promise<void> {
  const stuck = await tx.scrapeJob.findMany({
    where: {
      organizationId: orgId,
      harveyRunId: { not: null },
      status: { in: ['QUEUED', 'RUNNING'] },
      createdAt: { lt: new Date(now.getTime() - ORPHAN_GRACE_MS) },
    },
    take: 20,
  });
  for (const job of stuck) {
    if (await deps.isQueueJobAlive(LEAD_SCRAPE_QUEUE, harveyScrapeJobId(job.id))) continue;
    const { count } = await tx.scrapeJob.updateMany({
      where: { id: job.id, status: { in: ['QUEUED', 'RUNNING'] } },
      data: { status: 'FAILED', errorMessage: 'Busca interrompida (job perdido na fila).', finishedAt: now },
    });
    if (count === 0) continue;
    outcome.summary.orphans += 1;
    outcome.activities.push({
      activity: await recordHarveyEvent(tx, {
        organizationId: orgId,
        type: 'research.search',
        phase: 'RESEARCHING',
        title: `Pesquisa de ${job.businessType} em ${job.city}, ${job.state} interrompida`,
        idempotencyKey: `research.search:${job.id}:lost`,
        status: 'FAILED',
        errorMessage: 'O job da busca se perdeu (reinício do worker ou falha ao enfileirar).',
        runId: job.harveyRunId,
        campaignId: job.campaignId,
        scrapeJobId: job.id,
      }),
    });
  }
}

// Envio reivindicado e sem resultado há 10 min: o processo caiu entre o
// provedor e o banco. Vira SEND_UNKNOWN e vai para reconciliação; nunca reenvio cego.
async function flagStuckSends(
  tx: Prisma.TransactionClient,
  orgId: string,
  now: Date,
  outcome: OrgOutcome,
): Promise<void> {
  const stuck = await tx.outreachMessage.findMany({
    where: { organizationId: orgId, status: 'SENDING', sendClaimedAt: { lt: new Date(now.getTime() - SENDING_STUCK_MS) } },
    include: { lead: { select: { name: true, campaignId: true } } },
    take: 20,
  });
  for (const message of stuck) {
    const { count } = await tx.outreachMessage.updateMany({
      where: { id: message.id, status: 'SENDING' },
      data: { status: 'SEND_UNKNOWN', sendError: 'Sem confirmação do provedor (processo interrompido durante o envio).' },
    });
    if (count === 0) continue;
    outcome.summary.uncertainSends += 1;
    outcome.activities.push({
      leadName: message.lead.name,
      activity: await recordHarveyEvent(tx, {
        organizationId: orgId,
        type: 'outreach.send_uncertain',
        phase: 'SENDING',
        title: `Envio para ${message.lead.name} sem confirmação — reconciliando`,
        idempotencyKey: `outreach.send_uncertain:${message.id}:${message.sendClaimedAt?.getTime() ?? 0}`,
        status: 'FAILED',
        leadId: message.leadId,
        campaignId: message.lead.campaignId,
        outreachMessageId: message.id,
        channel: message.channel,
      }),
    });
  }
}

async function scheduleReconciliations(
  tx: Prisma.TransactionClient,
  deps: HarveyTickDeps,
  orgId: string,
  now: Date,
  outcome: OrgOutcome,
): Promise<void> {
  const unknown = await tx.outreachMessage.findMany({
    where: {
      organizationId: orgId,
      status: 'SEND_UNKNOWN',
      sendClaimedAt: { gt: new Date(now.getTime() - RECONCILE_WINDOW_MS) },
    },
    select: { id: true },
    take: 20,
  });
  for (const message of unknown) {
    if (await deps.kv.claim(`harvey:reconcile:${message.id}`, RECONCILE_RETRY_SECONDS)) {
      outcome.intents.push({ kind: 'reconcile', data: { organizationId: orgId, messageId: message.id } });
    }
  }
}
