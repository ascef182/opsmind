// Harvey (agente do Revenue Engine): estados, transições de comando e horário de
// trabalho por campanha. Funções puras, usadas por apps/api, apps/worker e web.
// Ver docs/superpowers/specs/2026-11-17-harvey-fase1-controle-design.md.

export type HarveyControlState = 'STOPPED' | 'ACTIVE' | 'PAUSED';
export type HarveyRunStatus = 'RUNNING' | 'PAUSED' | 'STOPPED' | 'COMPLETED';
export type HarveyPhase =
  | 'RESEARCHING'
  | 'QUALIFYING'
  | 'PREPARING_OUTREACH'
  | 'SENDING'
  | 'RESPONDING'
  | 'CONTROL';
export type HarveyActivityStatus = 'STARTED' | 'SUCCEEDED' | 'FAILED' | 'SKIPPED' | 'CANCELLED';
export type HarveyDisplayStatus =
  | 'IDLE'
  | 'RUNNING'
  | 'RESEARCHING'
  | 'QUALIFYING'
  | 'PREPARING_OUTREACH'
  | 'AWAITING_APPROVAL'
  | 'SENDING'
  | 'RESPONDING'
  | 'PAUSED'
  | 'STOPPED'
  | 'ERROR'
  | 'COMPLETED';
export type HarveyCommand = 'START' | 'PAUSE' | 'RESUME' | 'STOP';
export type HarveyRunEndReason =
  | 'GOALS_MET'
  | 'HOURS_ENDED'
  | 'STOPPED_BY_USER'
  | 'NO_WORK_AVAILABLE'
  | 'BUDGET_EXCEEDED'
  | 'DAY_ENDED_WHILE_PAUSED'
  | 'CAMPAIGN_PAUSED'
  | 'CAMPAIGN_CLOSED';

// Quem originou um job: só trabalho automático depende do estado do agente.
export type HarveyJobTrigger = 'AUTOMATIC' | 'MANUAL';

export const HARVEY_ACTIVITY_TYPES = [
  'research.search',
  'research.lead_found',
  'research.site_analysis',
  'qualification.score',
  'qualification.offering_match',
  'outreach.draft',
  'outreach.awaiting_approval',
  'outreach.sent',
  'outreach.send_blocked',
  'outreach.send_uncertain',
  'outreach.send_reconciled',
  'outreach.reply_received',
  'control.command',
  'run.started',
  'run.paused',
  'run.resumed',
  'run.stopped',
  'run.completed',
] as const;
export type HarveyActivityType = (typeof HARVEY_ACTIVITY_TYPES)[number];

export interface HarveyRationale {
  summary?: string;
  reasons: string[];
  evidence?: { quote: string; url: string | null }[];
}

// Forma serializada de uma atividade: publicada no Redis, devolvida pela API e
// consumida pela web.
export interface HarveyActivityEvent {
  id: string;
  organizationId: string;
  campaignId: string | null;
  runId: string | null;
  type: HarveyActivityType;
  phase: HarveyPhase;
  title: string;
  status: HarveyActivityStatus;
  startedAt: string;
  finishedAt: string | null;
  leadId: string | null;
  leadName: string | null;
  scrapeJobId: string | null;
  outreachMessageId: string | null;
  channel: string | null;
  result: Record<string, unknown> | null;
  rationale: HarveyRationale | null;
  errorMessage: string | null;
  actorType: string;
}

export type HarveyStreamEvent =
  | { kind: 'activity'; activity: HarveyActivityEvent }
  | { kind: 'status.changed' };

export const HARVEY_COMMAND_TRANSITIONS: Record<
  HarveyCommand,
  { from: HarveyControlState[]; to: HarveyControlState }
> = {
  START: { from: ['STOPPED'], to: 'ACTIVE' },
  PAUSE: { from: ['ACTIVE'], to: 'PAUSED' },
  RESUME: { from: ['PAUSED'], to: 'ACTIVE' },
  STOP: { from: ['ACTIVE', 'PAUSED'], to: 'STOPPED' },
};

export function harveyChannel(organizationId: string): string {
  return `harvey:org:${organizationId}`;
}

export interface WorkingHours {
  timezone: string;
  // 1 = segunda … 7 = domingo (ISO-8601)
  workingDays: number[];
  workStartMinute: number;
  workEndMinute: number;
}

const WEEKDAY_ISO: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

interface LocalParts {
  date: string;
  weekday: number;
  minuteOfDay: number;
}

function localParts(now: Date, timezone: string): LocalParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    weekday: WEEKDAY_ISO[get('weekday')] ?? 1,
    minuteOfDay: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export function cycleDateFor(now: Date, timezone: string): string {
  return localParts(now, timezone).date;
}

export function isWithinWorkingHours(now: Date, hours: WorkingHours): boolean {
  const local = localParts(now, hours.timezone);
  return (
    hours.workingDays.includes(local.weekday) &&
    local.minuteOfDay >= hours.workStartMinute &&
    local.minuteOfDay < hours.workEndMinute
  );
}

// Próximo instante (>= now) em que o horário de trabalho começa ou já está em
// curso. Busca minuto a minuto seria cara; anda por dia e acerta o minuto
// local de início com uma correção de fuso (cobre virada de horário de verão).
export function nextWorkStart(now: Date, hours: WorkingHours): Date | null {
  if (hours.workingDays.length === 0) return null;
  if (isWithinWorkingHours(now, hours)) return now;
  for (let dayOffset = 0; dayOffset <= 8; dayOffset += 1) {
    const probe = new Date(now.getTime() + dayOffset * 86_400_000);
    const local = localParts(probe, hours.timezone);
    if (!hours.workingDays.includes(local.weekday)) continue;
    const candidate = atLocalMinute(probe, local, hours.workStartMinute, hours.timezone);
    if (candidate.getTime() >= now.getTime()) return candidate;
  }
  return null;
}

function atLocalMinute(probe: Date, local: LocalParts, minute: number, timezone: string): Date {
  let guess = new Date(probe.getTime() + (minute - local.minuteOfDay) * 60_000);
  // Uma correção basta para o deslocamento de 1h do horário de verão.
  const check = localParts(guess, timezone);
  if (check.date === local.date && check.minuteOfDay !== minute) {
    guess = new Date(guess.getTime() + (minute - check.minuteOfDay) * 60_000);
  }
  return new Date(Math.floor(guess.getTime() / 60_000) * 60_000);
}

export interface HarveyStatusInput {
  controlState: HarveyControlState;
  everStarted: boolean;
  runs: { status: HarveyRunStatus; lastErrorAt: Date | null; lastSuccessAt: Date | null }[];
  inProgressPhases: HarveyPhase[];
  pendingApprovals: number;
  automaticWorkRemaining: boolean;
}

const PHASE_PRECEDENCE: HarveyPhase[] = [
  'SENDING',
  'RESPONDING',
  'PREPARING_OUTREACH',
  'QUALIFYING',
  'RESEARCHING',
];

export function resolveHarveyStatus(input: HarveyStatusInput): HarveyDisplayStatus {
  if (input.controlState === 'STOPPED') return input.everStarted ? 'STOPPED' : 'IDLE';
  if (input.controlState === 'PAUSED') return 'PAUSED';

  const busiest = PHASE_PRECEDENCE.find((phase) => input.inProgressPhases.includes(phase));
  if (busiest) return busiest as HarveyDisplayStatus;

  const failing = input.runs.some(
    (run) => run.lastErrorAt && (!run.lastSuccessAt || run.lastErrorAt > run.lastSuccessAt),
  );
  if (failing) return 'ERROR';

  if (input.runs.some((run) => run.status === 'RUNNING')) {
    return input.pendingApprovals > 0 && !input.automaticWorkRemaining ? 'AWAITING_APPROVAL' : 'RUNNING';
  }
  if (input.runs.length > 0 && input.runs.every((run) => run.status === 'COMPLETED')) return 'COMPLETED';
  return 'IDLE';
}

export const HARVEY_ORCHESTRATOR_QUEUE = 'harvey-orchestrator';
// Sem organizationId = tick periódico de todas as organizações.
export interface HarveyTickJobData {
  organizationId?: string;
}

export const OUTREACH_SEND_RECONCILE_QUEUE = 'outreach-send-reconcile';
export interface OutreachSendReconcileJobData {
  organizationId: string;
  messageId: string;
}
