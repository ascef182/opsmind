jest.mock('./tenant-context', () => ({
  withTenantContext: jest.fn((tx: unknown, _orgId: string, fn: (tx: unknown) => unknown) => fn(tx)),
}));

import { runHarveyTick, SENDING_STUCK_MS } from './harvey-orchestrator';

// Quarta 2026-11-18, 12:00 em São Paulo.
const NOW = new Date('2026-11-18T15:00:00Z');
const AFTER_HOURS = new Date('2026-11-18T22:00:00Z');
const TODAY = new Date('2026-11-18');

const campaign = {
  id: 'camp-1',
  organizationId: 'org-1',
  name: 'Metalúrgica — Campinas/SP',
  kind: 'STANDARD',
  status: 'ACTIVE',
  timezone: 'America/Sao_Paulo',
  workingDays: [1, 2, 3, 4, 5],
  workStartMinute: 540,
  workEndMinute: 1080,
  dailyResearchGoal: 30,
  dailyQualifiedGoal: 15,
  dailyOutreachGoal: 10,
  monthlyBudgetUsd: null,
};

function runRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'run-1',
    organizationId: 'org-1',
    campaignId: 'camp-1',
    cycleDate: TODAY,
    status: 'RUNNING',
    endReason: null,
    goals: { research: 30, qualified: 15, outreach: 10 },
    startedAt: new Date('2026-11-18T12:00:00Z'),
    endedAt: null,
    pausedAt: null,
    pausedMs: 0n,
    ...overrides,
  };
}

interface Scenario {
  control?: 'ACTIVE' | 'PAUSED' | 'STOPPED';
  locked?: boolean;
  todayRun?: Record<string, unknown> | null;
  staleRuns?: Record<string, unknown>[];
  counts?: { researched?: number; qualified?: number; prepared?: number };
  searchInFlight?: number;
  startedInRun?: number;
  targets?: Record<string, unknown>[];
  profileLeads?: Record<string, unknown>[];
  draftLeads?: Record<string, unknown>[];
  openActivities?: Record<string, unknown>[];
  stuckSends?: Record<string, unknown>[];
  unknownSends?: { id: string }[];
}

function build(scenario: Scenario = {}) {
  let run: Record<string, unknown> | null = scenario.todayRun === undefined ? runRow() : scenario.todayRun;
  const counts = scenario.counts ?? {};
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ locked: scenario.locked ?? true }]),
    harveyAgent: {
      findMany: jest.fn().mockResolvedValue([{ organizationId: 'org-1' }]),
      findUnique: jest.fn().mockResolvedValue({ controlState: scenario.control ?? 'ACTIVE' }),
    },
    salesCampaign: {
      findMany: jest.fn().mockResolvedValue([campaign]),
      findFirst: jest.fn().mockResolvedValue(campaign),
    },
    harveyRun: {
      findMany: jest.fn().mockResolvedValue(scenario.staleRuns ?? []),
      findUnique: jest.fn(async () => run),
      findUniqueOrThrow: jest.fn(async ({ where }: { where: { id: string } }) => ({ ...run, id: where.id })),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        run = { ...run, ...data };
        return run;
      }),
      updateMany: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        run = { ...run, ...data };
        return { count: 1 };
      }),
      createMany: jest.fn(async ({ data }: { data: Record<string, unknown>[] }) => {
        run = runRow({ ...data[0], id: 'run-new' });
        return { count: 1 };
      }),
    },
    harveyActivity: {
      count: jest.fn(async ({ where }: { where: { type?: string; status?: string; runId?: string } }) => {
        if (where.type === 'research.lead_found') return counts.researched ?? 0;
        if (where.type === 'qualification.score') return counts.qualified ?? 0;
        if (where.type === 'outreach.draft' && where.status === 'SUCCEEDED') return counts.prepared ?? 0;
        if (where.status === 'STARTED') return scenario.startedInRun ?? 0;
        return 0;
      }),
      findMany: jest.fn().mockResolvedValue(scenario.openActivities ?? []),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id, organizationId: 'org-1' })),
      upsert: jest.fn(async ({ create }: { create: Record<string, unknown> }) => ({ id: `evt-${create.type}`, ...create })),
    },
    outreachMessage: {
      findMany: jest.fn(async ({ where }: { where: { status: string } }) =>
        where.status === 'SENDING' ? (scenario.stuckSends ?? []) : (scenario.unknownSends ?? []),
      ),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    scrapeJob: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      count: jest.fn().mockResolvedValue(scenario.searchInFlight ?? 0),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'scrape-1', ...data })),
    },
    prospectingTarget: { findMany: jest.fn().mockResolvedValue(scenario.targets ?? []) },
    lead: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn(async ({ where }: { where: { website?: unknown } }) =>
        where.website ? (scenario.profileLeads ?? []) : (scenario.draftLeads ?? []),
      ),
    },
    auditLog: { create: jest.fn() },
    costEvent: { aggregate: jest.fn().mockResolvedValue({ _sum: { amountUsd: 0 } }) },
    organizationRevenueSettings: { findUnique: jest.fn().mockResolvedValue(null) },
  };
  const queues = {
    leadScrape: { add: jest.fn() },
    websiteProfile: { add: jest.fn() },
    outreachAutodraft: { add: jest.fn() },
    sendReconcile: { add: jest.fn() },
  };
  const claimed = new Set<string>();
  const kv = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn(),
    claim: jest.fn(async (key: string) => {
      if (claimed.has(key)) return false;
      claimed.add(key);
      return true;
    }),
  };
  const publish = jest.fn();
  const isQueueJobAlive = jest.fn().mockResolvedValue(false);
  const tick = (now = NOW) =>
    runHarveyTick({ prisma: tx as never, kv, queues: queues as never, isQueueJobAlive, publish, now: () => now });
  return { tx, queues, kv, publish, isQueueJobAlive, tick, getRun: () => run };
}

const target = (overrides: Record<string, unknown> = {}) => ({
  id: 'target-1',
  organizationId: 'org-1',
  campaignId: 'camp-1',
  sourceType: 'APIFY_GOOGLE_MAPS',
  city: 'Austin',
  state: 'TX',
  businessType: 'dentist',
  onlyWithoutWebsite: true,
  limit: 50,
  cooldownDays: 7,
  scrapeJobs: [],
  ...overrides,
});

describe('runHarveyTick', () => {
  it('opens one run inside working hours and records run.started', async () => {
    const { tx, tick } = build({ todayRun: null, targets: [target()] });
    const summary = await tick();
    expect(tx.harveyRun.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true, data: [expect.objectContaining({ cycleDate: TODAY, status: 'RUNNING' })] }),
    );
    expect(summary.runsOpened).toBe(1);
    expect(tx.harveyActivity.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ type: 'run.started' }) }),
    );
  });

  it.each(['PAUSED', 'STOPPED'] as const)('does not open a run when the agent is %s', async (control) => {
    const { tx, queues, tick } = build({ control, todayRun: null, targets: [target()] });
    await tick();
    expect(tx.harveyRun.createMany).not.toHaveBeenCalled();
    expect(queues.leadScrape.add).not.toHaveBeenCalled();
  });

  it('pauses a RUNNING run left behind by a race with the pause command', async () => {
    const { tick, getRun, queues } = build({ control: 'PAUSED', targets: [target()] });
    await tick();
    expect(getRun()).toMatchObject({ status: 'PAUSED', pausedAt: NOW });
    expect(queues.leadScrape.add).not.toHaveBeenCalled();
  });

  it('closes an open run with STOPPED_BY_USER when the agent is stopped', async () => {
    const { tx, tick } = build({ control: 'STOPPED' });
    await tick();
    expect(tx.harveyRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'STOPPED', endReason: 'STOPPED_BY_USER' }) }),
    );
  });

  it('completes the RUNNING run with HOURS_ENDED after the working window', async () => {
    const { tx, tick } = build();
    await tick(AFTER_HOURS);
    expect(tx.harveyRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED', endReason: 'HOURS_ENDED' }) }),
    );
  });

  it('closes paused run when day ends', async () => {
    const stale = runRow({ id: 'run-old', status: 'PAUSED', cycleDate: new Date('2026-11-17'), pausedAt: new Date('2026-11-17T20:00:00Z') });
    const { tx, tick } = build({ staleRuns: [stale] });
    await tick();
    expect(tx.harveyRun.updateMany).toHaveBeenCalledWith({
      where: { id: 'run-old', status: { in: ['RUNNING', 'PAUSED'] } },
      data: expect.objectContaining({ status: 'COMPLETED', endReason: 'DAY_ENDED_WHILE_PAUSED' }),
    });
  });

  it('creates the scrape job with limit=min(target.limit, remaining goal) and a fixed jobId', async () => {
    const { tx, queues, tick } = build({ targets: [target({ limit: 50 })], counts: { researched: 22 } });
    await tick();
    expect(tx.scrapeJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ harveyRunId: 'run-1', prospectingTargetId: 'target-1', limit: 8, actorType: 'SYSTEM' }),
    });
    expect(queues.leadScrape.add).toHaveBeenCalledWith(
      'scrape',
      { organizationId: 'org-1', scrapeJobId: 'scrape-1', actorType: 'SYSTEM' },
      { jobId: 'harvey-scrape-scrape-1' },
    );
  });

  it('never starts a second search while one of the run is in flight', async () => {
    const { tx, queues, tick } = build({ targets: [target()], searchInFlight: 1 });
    await tick();
    expect(tx.scrapeJob.create).not.toHaveBeenCalled();
    expect(queues.leadScrape.add).not.toHaveBeenCalled();
  });

  it('respects the target cooldown', async () => {
    const recent = target({ scrapeJobs: [{ createdAt: new Date('2026-11-15T10:00:00Z') }] });
    const { tx, tick } = build({ targets: [recent] });
    await tick();
    expect(tx.scrapeJob.create).not.toHaveBeenCalled();
  });

  it('a duplicate search from another replica (unique index) is ignored', async () => {
    const { tx, queues, tick } = build({ targets: [target()] });
    tx.scrapeJob.create.mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' }));
    await tick();
    expect(queues.leadScrape.add).not.toHaveBeenCalled();
  });

  it('resume re-enqueues skipped lead once (BullMQ deduplication by lead)', async () => {
    const { queues, tick } = build({
      profileLeads: [{ id: 'lead-site', website: 'https://x.com' }],
      draftLeads: [{ id: 'lead-wa', whatsapp: '5511999999999', socialLinks: null }],
    });
    await tick();
    expect(queues.websiteProfile.add).toHaveBeenCalledWith(
      'investigate',
      { organizationId: 'org-1', leadId: 'lead-site', actorType: 'SYSTEM', trigger: 'AUTOMATIC' },
      { deduplication: { id: 'website-profile:lead-site' } },
    );
    expect(queues.outreachAutodraft.add).toHaveBeenCalledWith(
      'autodraft',
      { organizationId: 'org-1', leadId: 'lead-wa', channel: 'WHATSAPP', trigger: 'AUTOMATIC' },
      { deduplication: { id: 'outreach-autodraft:lead-wa' } },
    );
  });

  it('respects the remaining outreach goal when enqueuing drafts', async () => {
    const leads = Array.from({ length: 6 }, (_, i) => ({ id: `lead-${i}`, whatsapp: '5511999999999', socialLinks: null }));
    const { queues, tick } = build({ draftLeads: leads, counts: { prepared: 8 } });
    await tick();
    expect(queues.outreachAutodraft.add).toHaveBeenCalledTimes(2);
  });

  it('marks orphan STARTED activity FAILED when its job is gone', async () => {
    const orphan = {
      id: 'act-1',
      type: 'research.site_analysis',
      status: 'STARTED',
      queueJobId: 'job-9',
      startedAt: new Date(NOW.getTime() - 5 * 60_000),
    };
    const { tx, tick, isQueueJobAlive } = build({ openActivities: [orphan] });
    const summary = await tick();
    expect(isQueueJobAlive).toHaveBeenCalledWith('website-profile', 'job-9');
    expect(tx.harveyActivity.updateMany).toHaveBeenCalledWith({
      where: { id: 'act-1', status: 'STARTED' },
      data: expect.objectContaining({ status: 'FAILED' }),
    });
    expect(summary.orphans).toBe(1);
  });

  it('keeps a STARTED activity whose job is still alive', async () => {
    const running = { id: 'act-1', type: 'research.search', status: 'STARTED', queueJobId: 'job-1', startedAt: new Date(NOW.getTime() - 30 * 60_000) };
    const { tx, tick, isQueueJobAlive } = build({ openActivities: [running] });
    isQueueJobAlive.mockResolvedValue(true);
    await tick();
    expect(tx.harveyActivity.updateMany).not.toHaveBeenCalled();
  });

  it('flags SENDING older than 10 min as SEND_UNKNOWN and enqueues one reconciliation', async () => {
    const stuck = {
      id: 'msg-1',
      leadId: 'lead-1',
      channel: 'EMAIL',
      status: 'SENDING',
      sendClaimedAt: new Date(NOW.getTime() - SENDING_STUCK_MS - 1000),
      lead: { name: 'Smile Dental', campaignId: 'camp-1' },
    };
    const { tx, queues, tick } = build({ stuckSends: [stuck], unknownSends: [{ id: 'msg-1' }] });
    const summary = await tick();
    expect(tx.outreachMessage.updateMany).toHaveBeenCalledWith({
      where: { id: 'msg-1', status: 'SENDING' },
      data: expect.objectContaining({ status: 'SEND_UNKNOWN' }),
    });
    expect(summary.uncertainSends).toBe(1);
    expect(queues.sendReconcile.add).toHaveBeenCalledTimes(1);

    await tick();
    expect(queues.sendReconcile.add).toHaveBeenCalledTimes(1);
  });

  it('completes with GOALS_MET when goals are met and nothing is in progress', async () => {
    const { tx, tick } = build({ counts: { qualified: 15, prepared: 10 } });
    await tick();
    expect(tx.harveyRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED', endReason: 'GOALS_MET' }) }),
    );
  });

  it('does not complete while work is still in progress', async () => {
    const { tx, tick } = build({ counts: { qualified: 15, prepared: 10 }, startedInRun: 1 });
    await tick();
    expect(tx.harveyRun.updateMany).not.toHaveBeenCalled();
  });

  it('skips org when advisory lock not acquired', async () => {
    const { tx, queues, tick } = build({ locked: false, todayRun: null, targets: [target()] });
    const summary = await tick();
    expect(summary.skippedLocked).toBe(1);
    expect(tx.harveyRun.createMany).not.toHaveBeenCalled();
    expect(queues.leadScrape.add).not.toHaveBeenCalled();
  });

  it('announces a status change only when it differs from the last one', async () => {
    const { tick, kv, publish } = build({ targets: [target()], searchInFlight: 1 });
    await tick();
    expect(publish).toHaveBeenCalledWith('org-1', { kind: 'status.changed' });
    kv.get.mockResolvedValue((kv.set.mock.calls[0] as [string, string])[1]);
    publish.mockClear();
    await tick();
    expect(publish).not.toHaveBeenCalledWith('org-1', { kind: 'status.changed' });
  });

  it('reopens a cycle closed for lack of work once a target becomes available', async () => {
    const { tx, tick } = build({
      todayRun: runRow({ status: 'COMPLETED', endReason: 'NO_WORK_AVAILABLE', endedAt: NOW }),
      targets: [target()],
    });
    await tick();
    expect(tx.harveyRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'RUNNING', endReason: null }) }),
    );
    expect(tx.scrapeJob.create).toHaveBeenCalledTimes(1);
  });

  it('keeps a cycle closed for lack of work closed while there is still nothing to do', async () => {
    const { tx, tick } = build({
      todayRun: runRow({ status: 'COMPLETED', endReason: 'NO_WORK_AVAILABLE', endedAt: NOW }),
    });
    await tick();
    expect(tx.harveyRun.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'RUNNING' }) }),
    );
  });

  it('fails a Harvey search stuck in the queue without a live job, freeing the next search', async () => {
    const { tx, tick, isQueueJobAlive } = build();
    tx.scrapeJob.findMany.mockImplementation(async ({ where }: { where: { harveyRunId?: unknown } }) =>
      where.harveyRunId
        ? [
            {
              id: 'scrape-old',
              harveyRunId: 'run-1',
              campaignId: 'camp-1',
              businessType: 'dentist',
              city: 'Austin',
              state: 'TX',
              status: 'QUEUED',
              createdAt: new Date(NOW.getTime() - 5 * 60_000),
            },
          ]
        : [],
    );
    await tick();
    expect(isQueueJobAlive).toHaveBeenCalledWith('lead-scrape', 'harvey-scrape-scrape-old');
    expect(tx.scrapeJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'scrape-old', status: { in: ['QUEUED', 'RUNNING'] } } }),
    );
  });

  it('a failed enqueue does not stop the remaining work of the tick', async () => {
    const { queues, tick } = build({
      targets: [target()],
      profileLeads: [{ id: 'lead-site', website: 'https://x.com' }],
    });
    queues.leadScrape.add.mockRejectedValueOnce(new Error('Custom Id cannot contain :'));
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await tick();
    errorSpy.mockRestore();
    expect(queues.websiteProfile.add).toHaveBeenCalledTimes(1);
  });
});
