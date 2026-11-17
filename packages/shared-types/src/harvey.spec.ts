import {
  HARVEY_COMMAND_TRANSITIONS,
  cycleDateFor,
  isValidTimezone,
  isWithinWorkingHours,
  nextWorkStart,
  resolveHarveyStatus,
  type HarveyStatusInput,
  type WorkingHours,
} from './harvey';

describe('cycleDateFor', () => {
  it('uses the campaign timezone, not UTC', () => {
    expect(cycleDateFor(new Date('2026-11-18T02:30:00Z'), 'America/New_York')).toBe('2026-11-17');
  });

  it('handles the DST start day', () => {
    expect(cycleDateFor(new Date('2027-03-14T07:30:00Z'), 'America/New_York')).toBe('2027-03-14');
  });
});

describe('isWithinWorkingHours / nextWorkStart', () => {
  const hours: WorkingHours = {
    timezone: 'America/Sao_Paulo',
    workingDays: [1, 2, 3, 4, 5],
    workStartMinute: 540,
    workEndMinute: 1080,
  };

  it('is inside at 09:00 local on a Wednesday', () => {
    expect(isWithinWorkingHours(new Date('2026-11-18T12:00:00Z'), hours)).toBe(true);
  });

  it('treats the end minute as exclusive', () => {
    expect(isWithinWorkingHours(new Date('2026-11-18T21:00:00Z'), hours)).toBe(false);
  });

  it('is outside on a Saturday', () => {
    expect(isWithinWorkingHours(new Date('2026-11-21T15:00:00Z'), hours)).toBe(false);
  });

  it('skips the weekend for the next start', () => {
    expect(nextWorkStart(new Date('2026-11-20T22:00:00Z'), hours)?.toISOString()).toBe('2026-11-23T12:00:00.000Z');
  });

  it('returns the same day start when before working hours', () => {
    expect(nextWorkStart(new Date('2026-11-18T10:00:00Z'), hours)?.toISOString()).toBe('2026-11-18T12:00:00.000Z');
  });

  it('returns null when no working day is configured', () => {
    expect(nextWorkStart(new Date('2026-11-18T10:00:00Z'), { ...hours, workingDays: [] })).toBeNull();
  });

  it('honours DST in New York (09:00 EDT is 13:00Z)', () => {
    const ny: WorkingHours = { ...hours, timezone: 'America/New_York' };
    expect(isWithinWorkingHours(new Date('2027-03-15T13:00:00Z'), ny)).toBe(true);
    expect(isWithinWorkingHours(new Date('2027-03-15T12:59:00Z'), ny)).toBe(false);
  });
});

describe('isValidTimezone', () => {
  it('accepts IANA names and rejects junk', () => {
    expect(isValidTimezone('America/Sao_Paulo')).toBe(true);
    expect(isValidTimezone('UTC')).toBe(true);
    expect(isValidTimezone('Mars/Base')).toBe(false);
  });
});

describe('HARVEY_COMMAND_TRANSITIONS', () => {
  it('matches the spec table', () => {
    expect(HARVEY_COMMAND_TRANSITIONS).toEqual({
      START: { from: ['STOPPED'], to: 'ACTIVE' },
      PAUSE: { from: ['ACTIVE'], to: 'PAUSED' },
      RESUME: { from: ['PAUSED'], to: 'ACTIVE' },
      STOP: { from: ['ACTIVE', 'PAUSED'], to: 'STOPPED' },
    });
  });
});

describe('resolveHarveyStatus', () => {
  const base: HarveyStatusInput = {
    controlState: 'ACTIVE',
    everStarted: true,
    runs: [{ status: 'RUNNING', lastErrorAt: null, lastSuccessAt: null }],
    inProgressPhases: [],
    pendingApprovals: 0,
    automaticWorkRemaining: true,
  };

  it.each<[Partial<HarveyStatusInput>, string]>([
    [{ controlState: 'STOPPED', everStarted: false }, 'IDLE'],
    [{ controlState: 'STOPPED' }, 'STOPPED'],
    [{ controlState: 'PAUSED' }, 'PAUSED'],
    [{ inProgressPhases: ['RESEARCHING', 'PREPARING_OUTREACH'] }, 'PREPARING_OUTREACH'],
    [{ inProgressPhases: ['QUALIFYING', 'SENDING'] }, 'SENDING'],
    [{ inProgressPhases: ['RESPONDING', 'RESEARCHING'] }, 'RESPONDING'],
    [{ pendingApprovals: 3, automaticWorkRemaining: false }, 'AWAITING_APPROVAL'],
    [{ pendingApprovals: 3, automaticWorkRemaining: true }, 'RUNNING'],
    [{}, 'RUNNING'],
    [{ runs: [{ status: 'COMPLETED', lastErrorAt: null, lastSuccessAt: null }] }, 'COMPLETED'],
    [{ runs: [] }, 'IDLE'],
    [{ runs: [{ status: 'RUNNING', lastErrorAt: new Date(2), lastSuccessAt: new Date(1) }] }, 'ERROR'],
    [{ runs: [{ status: 'RUNNING', lastErrorAt: new Date(1), lastSuccessAt: new Date(2) }] }, 'RUNNING'],
  ])('%o → %s', (patch, expected) => {
    expect(resolveHarveyStatus({ ...base, ...patch })).toBe(expected);
  });

  it('shows work in progress over an older error', () => {
    expect(
      resolveHarveyStatus({
        ...base,
        runs: [{ status: 'RUNNING', lastErrorAt: new Date(2), lastSuccessAt: null }],
        inProgressPhases: ['RESEARCHING'],
      }),
    ).toBe('RESEARCHING');
  });
});
