import { Injectable } from '@nestjs/common';
import {
  finishHarveyActivity,
  recordHarveyEvent,
  startHarveyActivity,
  toHarveyActivityEvent,
  type HarveyActivity,
  type StartActivityInput,
} from '@opsmind/database';
import type { HarveyActivityStatus, HarveyRationale } from '@opsmind/shared-types';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { runAfterCommit } from '../../shared/context/after-commit';
import { HarveyEventsPublisher } from './harvey-events.publisher';

type FinishOutcome = {
  status: Exclude<HarveyActivityStatus, 'STARTED'>;
  title?: string;
  result?: Record<string, unknown> | null;
  rationale?: HarveyRationale | null;
  errorMessage?: string | null;
};

// Grava atividades do Harvey pela transação ativa (proxy do Prisma) e publica
// o evento só depois do commit.
@Injectable()
export class HarveyActivityRecorder {
  constructor(
    private readonly prisma: PrismaService,
    private readonly publisher: HarveyEventsPublisher,
  ) {}

  async start(input: StartActivityInput): Promise<HarveyActivity> {
    return this.emit(await startHarveyActivity(this.prisma, input));
  }

  async finish(id: string, outcome: FinishOutcome): Promise<HarveyActivity> {
    return this.emit(await finishHarveyActivity(this.prisma, id, outcome));
  }

  async event(
    input: StartActivityInput & { status: Exclude<HarveyActivityStatus, 'STARTED'>; errorMessage?: string | null },
  ): Promise<HarveyActivity> {
    return this.emit(await recordHarveyEvent(this.prisma, input));
  }

  statusChanged(organizationId: string): void {
    runAfterCommit(() => this.publisher.publish(organizationId, { kind: 'status.changed' }));
  }

  private async emit(activity: HarveyActivity): Promise<HarveyActivity> {
    const lead = activity.leadId
      ? await this.prisma.lead.findFirst({ where: { id: activity.leadId }, select: { name: true } })
      : null;
    const event = toHarveyActivityEvent(activity, lead?.name ?? null);
    runAfterCommit(() => this.publisher.publish(activity.organizationId, { kind: 'activity', activity: event }));
    return activity;
  }
}
