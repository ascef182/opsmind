import { ConflictException, Injectable } from '@nestjs/common';
import { getRunProgress, toHarveyActivityEvent, type HarveyRun, type Prisma, type SalesCampaign } from '@opsmind/database';
import {
  HARVEY_COMMAND_TRANSITIONS,
  cycleDateFor,
  nextWorkStart,
  resolveHarveyStatus,
  type HarveyActivityEvent,
  type HarveyCommand,
  type HarveyControlState,
  type HarveyDisplayStatus,
  type HarveyPhase,
} from '@opsmind/shared-types';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { HarveyOrchestratorQueueService } from '../../infrastructure/queue/harvey-orchestrator-queue.service';
import { runAfterCommit } from '../../shared/context/after-commit';
import { AuditService } from '../audit/audit.service';
import { HarveyActivityRecorder } from './harvey-activity.recorder';
import type { ListHarveyActivitiesQueryDto } from './dto/harvey-command.dto';

export interface HarveyRunSnapshot {
  runId: string | null;
  campaignId: string;
  campaignName: string;
  country: string;
  timezone: string;
  workStartMinute: number;
  workEndMinute: number;
  cycleDate: string;
  status: HarveyRun['status'] | null;
  endReason: string | null;
  goals: { research: number; qualified: number; outreach: number };
  progress: { researched: number; qualified: number; prepared: number };
  runningMs: number;
  pausedMs: number;
  activeTargets: number;
}

export interface HarveySnapshot {
  status: HarveyDisplayStatus;
  controlState: HarveyControlState;
  controlChangedAt: string | null;
  inProgress: HarveyActivityEvent[];
  runs: HarveyRunSnapshot[];
  pendingApprovals: number;
  nextWorkStart: string | null;
  lastError: string | null;
}

const COMMAND_LABELS: Record<HarveyCommand, string> = {
  START: 'Harvey iniciado',
  PAUSE: 'Harvey pausado',
  RESUME: 'Harvey retomado',
  STOP: 'Harvey parado',
};

function cycleDateValue(now: Date, campaign: Pick<SalesCampaign, 'timezone'>): Date {
  return new Date(cycleDateFor(now, campaign.timezone));
}

export function runElapsed(run: Pick<HarveyRun, 'startedAt' | 'endedAt' | 'pausedAt' | 'pausedMs'>, now: Date) {
  const end = run.endedAt ?? now;
  const pausedMs = Number(run.pausedMs) + (run.pausedAt && !run.endedAt ? now.getTime() - run.pausedAt.getTime() : 0);
  return { runningMs: Math.max(0, end.getTime() - run.startedAt.getTime() - pausedMs), pausedMs };
}

@Injectable()
export class HarveyControlService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly recorder: HarveyActivityRecorder,
    private readonly orchestratorQueue: HarveyOrchestratorQueueService,
  ) {}

  async command(
    organizationId: string,
    command: HarveyCommand,
    userId: string,
    reason?: string,
    now: Date = new Date(),
  ): Promise<HarveySnapshot> {
    const transition = HARVEY_COMMAND_TRANSITIONS[command];
    // Serializa com o tick do worker para a mesma organização.
    await this.prisma.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`harvey:${organizationId}`}))`;
    await this.prisma.harveyAgent.upsert({
      where: { organizationId },
      create: { organizationId },
      update: {},
    });
    const changed = await this.prisma.harveyAgent.updateMany({
      where: { organizationId, controlState: { in: transition.from } },
      data: {
        controlState: transition.to,
        controlChangedAt: now,
        controlChangedByUserId: userId,
        version: { increment: 1 },
      },
    });
    if (changed.count === 0) {
      const current = await this.prisma.harveyAgent.findUnique({ where: { organizationId } });
      throw new ConflictException(
        `Comando ${command} não é válido com o Harvey em ${current?.controlState ?? 'STOPPED'}.`,
      );
    }

    await this.applyToRuns(organizationId, command, now);

    await this.auditService.log({
      actorType: 'USER',
      actorId: userId,
      organizationId,
      action: `harvey.command.${command.toLowerCase()}`,
      resource: `Organization:${organizationId}`,
      metadata: { reason: reason ?? null } as Prisma.InputJsonValue,
    });
    await this.recorder.event({
      organizationId,
      type: 'control.command',
      phase: 'CONTROL',
      title: COMMAND_LABELS[command],
      idempotencyKey: `control.command:${organizationId}:${now.getTime()}:${command}`,
      status: 'SUCCEEDED',
      result: { command, reason: reason ?? null },
      actorType: 'USER',
      actorId: userId,
    });
    this.recorder.statusChanged(organizationId);
    if (command === 'START' || command === 'RESUME') {
      runAfterCommit(() => this.orchestratorQueue.requestTick(organizationId));
    }
    return this.snapshot(organizationId, now);
  }

  private async applyToRuns(organizationId: string, command: HarveyCommand, now: Date): Promise<void> {
    if (command === 'PAUSE') {
      await this.prisma.harveyRun.updateMany({
        where: { organizationId, status: 'RUNNING' },
        data: { status: 'PAUSED', pausedAt: now },
      });
      return;
    }
    if (command === 'START') {
      // Parar e iniciar de novo no mesmo dia retoma o ciclo de hoje (o tempo
      // parado conta como pausa); ciclos de dias anteriores ficam encerrados.
      const stopped = await this.prisma.harveyRun.findMany({
        where: { organizationId, status: 'STOPPED', endReason: 'STOPPED_BY_USER' },
        include: { campaign: { select: { timezone: true } } },
      });
      for (const run of stopped) {
        if (run.cycleDate.getTime() !== cycleDateValue(now, run.campaign).getTime()) continue;
        const stoppedMs = run.endedAt ? BigInt(now.getTime() - run.endedAt.getTime()) : 0n;
        await this.prisma.harveyRun.update({
          where: { id: run.id },
          data: { status: 'RUNNING', endReason: null, endedAt: null, pausedMs: { increment: stoppedMs } },
        });
      }
      return;
    }

    const open = await this.prisma.harveyRun.findMany({
      where: { organizationId, status: { in: ['RUNNING', 'PAUSED'] } },
      include: { campaign: { select: { timezone: true } } },
    });
    for (const run of open) {
      const pausedMs = run.pausedAt ? BigInt(now.getTime() - run.pausedAt.getTime()) : 0n;
      if (command === 'STOP') {
        await this.prisma.harveyRun.update({
          where: { id: run.id },
          data: {
            status: 'STOPPED',
            endReason: 'STOPPED_BY_USER',
            endedAt: now,
            pausedAt: null,
            pausedMs: { increment: pausedMs },
          },
        });
        continue;
      }
      // RESUME: só o ciclo de hoje volta; o de um dia que já passou é fechado pelo tick.
      const isToday = run.cycleDate.getTime() === cycleDateValue(now, run.campaign).getTime();
      if (run.status === 'PAUSED' && isToday) {
        await this.prisma.harveyRun.update({
          where: { id: run.id },
          data: { status: 'RUNNING', pausedAt: null, pausedMs: { increment: pausedMs } },
        });
      }
    }
  }

  async snapshot(organizationId: string, now: Date = new Date()): Promise<HarveySnapshot> {
    const [agent, campaigns, inProgressRows, pendingApprovals, anyRun] = await Promise.all([
      this.prisma.harveyAgent.findUnique({ where: { organizationId } }),
      this.prisma.salesCampaign.findMany({
        where: { organizationId, kind: 'STANDARD', status: 'ACTIVE' },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.harveyActivity.findMany({
        where: { organizationId, status: 'STARTED' },
        orderBy: { startedAt: 'desc' },
        take: 20,
        include: { lead: { select: { name: true } } },
      }),
      this.prisma.outreachMessage.count({ where: { organizationId, status: 'DRAFT' } }),
      this.prisma.harveyRun.findFirst({ where: { organizationId }, select: { id: true } }),
    ]);
    const controlState = (agent?.controlState ?? 'STOPPED') as HarveyControlState;

    const runs: HarveyRunSnapshot[] = [];
    const statusRuns: { status: HarveyRun['status']; lastErrorAt: Date | null; lastSuccessAt: Date | null }[] = [];
    let lastError: string | null = null;
    let automaticWorkRemaining = false;
    for (const campaign of campaigns) {
      const cycleDate = cycleDateFor(now, campaign.timezone);
      const run = await this.prisma.harveyRun.findUnique({
        where: { campaignId_cycleDate: { campaignId: campaign.id, cycleDate: new Date(cycleDate) } },
      });
      const progress = run ? await getRunProgress(this.prisma, run.id) : { researched: 0, qualified: 0, prepared: 0 };
      const elapsed = run ? runElapsed(run, now) : { runningMs: 0, pausedMs: 0 };
      const activeTargets = await this.prisma.prospectingTarget.count({
        where: { organizationId, campaignId: campaign.id, isActive: true },
      });
      runs.push({
        runId: run?.id ?? null,
        campaignId: campaign.id,
        campaignName: campaign.name,
        country: campaign.country,
        timezone: campaign.timezone,
        workStartMinute: campaign.workStartMinute,
        workEndMinute: campaign.workEndMinute,
        cycleDate,
        status: run?.status ?? null,
        endReason: run?.endReason ?? null,
        goals: {
          research: campaign.dailyResearchGoal,
          qualified: campaign.dailyQualifiedGoal,
          outreach: campaign.dailyOutreachGoal,
        },
        progress,
        ...elapsed,
        activeTargets,
      });
      if (run) {
        statusRuns.push({ status: run.status, lastErrorAt: run.lastErrorAt, lastSuccessAt: run.lastSuccessAt });
        if (run.lastErrorAt && (!run.lastSuccessAt || run.lastErrorAt > run.lastSuccessAt)) {
          lastError = run.lastErrorMessage;
        }
        if (run.status === 'RUNNING') {
          automaticWorkRemaining ||= await this.hasAutomaticWork(organizationId, campaign, progress);
        }
      }
    }

    const nextStarts = campaigns
      .map((campaign) => nextWorkStart(now, campaign))
      .filter((date): date is Date => date !== null)
      .sort((a, b) => a.getTime() - b.getTime());

    return {
      status: resolveHarveyStatus({
        controlState,
        everStarted: anyRun !== null || agent?.controlChangedAt != null,
        runs: statusRuns,
        inProgressPhases: inProgressRows.map((row) => row.phase as HarveyPhase),
        pendingApprovals,
        automaticWorkRemaining,
      }),
      controlState,
      controlChangedAt: agent?.controlChangedAt?.toISOString() ?? null,
      inProgress: inProgressRows.map((row) => toHarveyActivityEvent(row, row.lead?.name ?? null)),
      runs,
      pendingApprovals,
      nextWorkStart: nextStarts[0]?.toISOString() ?? null,
      lastError,
    };
  }

  private async hasAutomaticWork(
    organizationId: string,
    campaign: SalesCampaign,
    progress: { researched: number; qualified: number; prepared: number },
  ): Promise<boolean> {
    const researchOpen =
      progress.researched < campaign.dailyResearchGoal && progress.qualified < campaign.dailyQualifiedGoal;
    if (researchOpen) {
      const targets = await this.prisma.prospectingTarget.count({
        where: { organizationId, campaignId: campaign.id, isActive: true },
      });
      if (targets > 0) return true;
    }
    if (progress.prepared >= campaign.dailyOutreachGoal) return false;
    const draftable = await this.prisma.lead.count({
      where: {
        organizationId,
        campaignId: campaign.id,
        status: 'QUALIFIED',
        suggestedOfferingId: { not: null },
        outreachMessages: { none: {} },
      },
    });
    return draftable > 0;
  }

  async listActivities(
    organizationId: string,
    query: ListHarveyActivitiesQueryDto,
    limit = 50,
  ): Promise<{ items: HarveyActivityEvent[]; nextCursor: string | null }> {
    const where: Prisma.HarveyActivityWhereInput = {
      organizationId,
      ...(query.phase ? { phase: query.phase as HarveyPhase } : {}),
      ...(query.status ? { status: query.status as Prisma.EnumHarveyActivityStatusFilter['equals'] } : {}),
      ...(query.leadId ? { leadId: query.leadId } : {}),
      ...(query.campaignId ? { campaignId: query.campaignId } : {}),
    };
    const after = query.after ? new Date(query.after) : null;
    if (after && !Number.isNaN(after.getTime())) {
      // Reconexão do stream: tudo que mudou desde o último evento visto.
      const rows = await this.prisma.harveyActivity.findMany({
        where: { ...where, updatedAt: { gt: after } },
        orderBy: { updatedAt: 'asc' },
        take: 200,
        include: { lead: { select: { name: true } } },
      });
      return { items: rows.map((row) => toHarveyActivityEvent(row, row.lead?.name ?? null)), nextCursor: null };
    }
    const rows = await this.prisma.harveyActivity.findMany({
      where,
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: { lead: { select: { name: true } } },
    });
    const page = rows.slice(0, limit);
    return {
      items: page.map((row) => toHarveyActivityEvent(row, row.lead?.name ?? null)),
      nextCursor: rows.length > limit ? (page[page.length - 1]?.id ?? null) : null,
    };
  }
}
