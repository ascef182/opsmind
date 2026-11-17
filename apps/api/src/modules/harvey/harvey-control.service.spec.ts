import { ConflictException } from '@nestjs/common';
import { HarveyControlService, runElapsed } from './harvey-control.service';

const now = new Date('2026-11-18T15:00:00Z');

function build(controlState: 'STOPPED' | 'ACTIVE' | 'PAUSED', runs: object[] = []) {
  const agent = { organizationId: 'org-1', controlState, controlChangedAt: null };
  const prisma = {
    $executeRaw: jest.fn(),
    harveyAgent: {
      upsert: jest.fn(),
      updateMany: jest.fn(async ({ where, data }: { where: { controlState: { in: string[] } }; data: { controlState: string } }) => {
        if (!where.controlState.in.includes(agent.controlState)) return { count: 0 };
        agent.controlState = data.controlState as never;
        return { count: 1 };
      }),
      findUnique: jest.fn(async () => agent),
    },
    harveyRun: {
      updateMany: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn().mockResolvedValue(runs),
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    salesCampaign: { findMany: jest.fn().mockResolvedValue([]) },
    harveyActivity: { findMany: jest.fn().mockResolvedValue([]) },
    outreachMessage: { count: jest.fn().mockResolvedValue(0) },
  };
  const audit = { log: jest.fn() };
  const recorder = { event: jest.fn(), statusChanged: jest.fn() };
  const queue = { requestTick: jest.fn() };
  const service = new HarveyControlService(prisma as never, audit as never, recorder as never, queue as never);
  return { prisma, audit, recorder, queue, service, agent };
}

describe('HarveyControlService.command', () => {
  it('START from STOPPED → ACTIVE, audited, recorded and announced', async () => {
    const { service, agent, audit, recorder } = build('STOPPED');
    const snapshot = await service.command('org-1', 'START', 'u1', undefined, now);
    expect(agent.controlState).toBe('ACTIVE');
    expect(snapshot.controlState).toBe('ACTIVE');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'harvey.command.start' }));
    expect(recorder.event).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'control.command', status: 'SUCCEEDED', actorType: 'USER' }),
    );
    expect(recorder.statusChanged).toHaveBeenCalledWith('org-1');
  });

  it('takes the per-organization advisory lock shared with the worker tick', async () => {
    const { service, prisma } = build('STOPPED');
    await service.command('org-1', 'START', 'u1', undefined, now);
    const [strings, ...values] = prisma.$executeRaw.mock.calls[0];
    expect(strings.join('?')).toContain('pg_advisory_xact_lock');
    expect(values).toContain('harvey:org-1');
  });

  it('PAUSE marks RUNNING runs PAUSED with pausedAt', async () => {
    const { service, prisma } = build('ACTIVE');
    await service.command('org-1', 'PAUSE', 'u1', undefined, now);
    expect(prisma.harveyRun.updateMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', status: 'RUNNING' },
      data: { status: 'PAUSED', pausedAt: now },
    });
  });

  it('RESUME adds the paused duration and reopens only today’s run', async () => {
    const today = {
      id: 'run-today',
      status: 'PAUSED',
      pausedAt: new Date('2026-11-18T14:00:00Z'),
      cycleDate: new Date('2026-11-18'),
      campaign: { timezone: 'America/Sao_Paulo' },
    };
    const yesterday = { ...today, id: 'run-old', cycleDate: new Date('2026-11-17') };
    const { service, prisma } = build('PAUSED', [today, yesterday]);
    await service.command('org-1', 'RESUME', 'u1', undefined, now);
    expect(prisma.harveyRun.update).toHaveBeenCalledTimes(1);
    expect(prisma.harveyRun.update).toHaveBeenCalledWith({
      where: { id: 'run-today' },
      data: { status: 'RUNNING', pausedAt: null, pausedMs: { increment: 3_600_000n } },
    });
  });

  it('STOP closes open runs with STOPPED_BY_USER', async () => {
    const run = { id: 'run-1', status: 'RUNNING', pausedAt: null, cycleDate: new Date('2026-11-18'), campaign: { timezone: 'UTC' } };
    const { service, prisma } = build('ACTIVE', [run]);
    await service.command('org-1', 'STOP', 'u1', undefined, now);
    expect(prisma.harveyRun.update).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      data: expect.objectContaining({ status: 'STOPPED', endReason: 'STOPPED_BY_USER', endedAt: now }),
    });
  });

  it('RESUME when STOPPED → 409 and nothing changes', async () => {
    const { service, audit } = build('STOPPED');
    await expect(service.command('org-1', 'RESUME', 'u1', undefined, now)).rejects.toBeInstanceOf(ConflictException);
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('a second concurrent PAUSE gets 409', async () => {
    const { service } = build('ACTIVE');
    await service.command('org-1', 'PAUSE', 'u1', undefined, now);
    await expect(service.command('org-1', 'PAUSE', 'u1', undefined, now)).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('runElapsed', () => {
  it('excludes paused time, including an ongoing pause', () => {
    const elapsed = runElapsed(
      {
        startedAt: new Date('2026-11-18T12:00:00Z'),
        endedAt: null,
        pausedAt: new Date('2026-11-18T14:30:00Z'),
        pausedMs: 600_000n,
      },
      now,
    );
    expect(elapsed).toEqual({ runningMs: 3 * 3_600_000 - 600_000 - 1_800_000, pausedMs: 600_000 + 1_800_000 });
  });
});
