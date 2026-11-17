import { checkHarveyMayProceed, startHarveyActivity } from '@opsmind/database';

const campaign = {
  id: 'camp-1',
  organizationId: 'org-1',
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

// Quarta 2026-11-18, 12:00 em São Paulo.
const insideHours = new Date('2026-11-18T15:00:00Z');
const outsideHours = new Date('2026-11-18T23:00:00Z');

function buildDb(opts: {
  control?: 'ACTIVE' | 'PAUSED' | 'STOPPED' | null;
  run?: { id: string; status: string } | null;
  counts?: { researched?: number; qualified?: number; prepared?: number };
  engineSpent?: number;
}) {
  const counts = opts.counts ?? {};
  return {
    harveyAgent: {
      findUnique: jest.fn().mockResolvedValue(opts.control === null ? null : { controlState: opts.control ?? 'ACTIVE' }),
    },
    salesCampaign: { findFirst: jest.fn().mockResolvedValue(campaign) },
    harveyRun: {
      findUnique: jest.fn().mockResolvedValue(opts.run === undefined ? { id: 'run-1', status: 'RUNNING' } : opts.run),
    },
    harveyActivity: {
      count: jest.fn(async ({ where }: { where: { type: string } }) => {
        if (where.type === 'research.lead_found') return counts.researched ?? 0;
        if (where.type === 'qualification.score') return counts.qualified ?? 0;
        return counts.prepared ?? 0;
      }),
    },
    costEvent: { aggregate: jest.fn().mockResolvedValue({ _sum: { amountUsd: opts.engineSpent ?? 0 } }) },
    organizationRevenueSettings: { findUnique: jest.fn().mockResolvedValue(null) },
  };
}

const check = (db: unknown, step: Parameters<typeof checkHarveyMayProceed>[1]['step'], now = insideHours) =>
  checkHarveyMayProceed(db as never, { organizationId: 'org-1', campaignId: 'camp-1', step, now });

describe('checkHarveyMayProceed', () => {
  it('blocks every step when the agent is paused', async () => {
    for (const step of ['research', 'site_analysis', 'outreach_draft', 'send'] as const) {
      await expect(check(buildDb({ control: 'PAUSED' }), step)).resolves.toEqual({ ok: false, reason: 'AGENT_PAUSED' });
    }
  });

  it('treats a missing agent row as stopped', async () => {
    await expect(check(buildDb({ control: null }), 'research')).resolves.toEqual({ ok: false, reason: 'AGENT_STOPPED' });
  });

  it('send only checks the control state', async () => {
    await expect(check(buildDb({}), 'send', outsideHours)).resolves.toEqual({ ok: true, runId: null });
  });

  it('refuses outside working hours', async () => {
    await expect(check(buildDb({}), 'site_analysis', outsideHours)).resolves.toEqual({
      ok: false,
      reason: 'OUTSIDE_WORKING_HOURS',
    });
  });

  it('refuses without a running cycle', async () => {
    await expect(check(buildDb({ run: { id: 'run-1', status: 'PAUSED' } }), 'site_analysis')).resolves.toEqual({
      ok: false,
      reason: 'RUN_NOT_RUNNING',
    });
  });

  it('research stops at the research goal', async () => {
    await expect(check(buildDb({ counts: { researched: 30 } }), 'research')).resolves.toEqual({
      ok: false,
      reason: 'GOAL_REACHED',
    });
  });

  it('research stops once the qualified goal is met', async () => {
    await expect(check(buildDb({ counts: { qualified: 15 } }), 'research')).resolves.toEqual({
      ok: false,
      reason: 'GOAL_REACHED',
    });
  });

  it('drafting stops at the outreach goal', async () => {
    await expect(check(buildDb({ counts: { prepared: 10 } }), 'outreach_draft')).resolves.toEqual({
      ok: false,
      reason: 'GOAL_REACHED',
    });
  });

  it('refuses when the engine budget is exceeded', async () => {
    await expect(check(buildDb({ engineSpent: 50 }), 'research')).resolves.toEqual({
      ok: false,
      reason: 'BUDGET_EXCEEDED',
    });
  });

  it('allows and returns the run id', async () => {
    await expect(check(buildDb({}), 'outreach_draft')).resolves.toEqual({ ok: true, runId: 'run-1' });
  });
});

describe('startHarveyActivity', () => {
  const input = {
    organizationId: 'org-1',
    type: 'research.search' as const,
    phase: 'RESEARCHING' as const,
    title: 'Pesquisando',
    idempotencyKey: 'research.search:job-1',
  };

  it('creates on first call and reuses the row on retry', async () => {
    const rows = new Map<string, { id: string; status: string; queueJobId: string | null; runId: string | null }>();
    const db = {
      harveyActivity: {
        findUnique: jest.fn(async () => rows.get(input.idempotencyKey) ?? null),
        create: jest.fn(async () => {
          const row = { id: 'act-1', status: 'STARTED', queueJobId: null, runId: null };
          rows.set(input.idempotencyKey, row);
          return row;
        }),
        update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...rows.get(input.idempotencyKey), ...data })),
      },
    };
    await startHarveyActivity(db as never, input);
    rows.get(input.idempotencyKey)!.status = 'FAILED';
    await startHarveyActivity(db as never, input);
    expect(db.harveyActivity.create).toHaveBeenCalledTimes(1);
    expect(db.harveyActivity.update).toHaveBeenCalledTimes(1);
  });

  it('does not reopen an activity that already succeeded', async () => {
    const done = { id: 'act-1', status: 'SUCCEEDED' };
    const db = { harveyActivity: { findUnique: jest.fn().mockResolvedValue(done), create: jest.fn(), update: jest.fn() } };
    await expect(startHarveyActivity(db as never, input)).resolves.toBe(done);
    expect(db.harveyActivity.update).not.toHaveBeenCalled();
  });
});
