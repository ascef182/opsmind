// Tipos do Harvey no front — duplicados de propósito (ver
// lib/customers/types.ts): o web não importa tipos do Prisma.

export type HarveyControlState = 'STOPPED' | 'ACTIVE' | 'PAUSED';
export type HarveyCommand = 'START' | 'PAUSE' | 'RESUME' | 'STOP';
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
export type HarveyPhase = 'RESEARCHING' | 'QUALIFYING' | 'PREPARING_OUTREACH' | 'SENDING' | 'RESPONDING' | 'CONTROL';
export type HarveyActivityStatus = 'STARTED' | 'SUCCEEDED' | 'FAILED' | 'SKIPPED' | 'CANCELLED';

export interface HarveyActivity {
  id: string;
  campaignId: string | null;
  runId: string | null;
  type: string;
  phase: HarveyPhase;
  title: string;
  status: HarveyActivityStatus;
  startedAt: string;
  finishedAt: string | null;
  leadId: string | null;
  leadName: string | null;
  outreachMessageId: string | null;
  channel: string | null;
  result: Record<string, unknown> | null;
  rationale: { summary?: string; reasons: string[]; evidence?: { quote: string; url: string | null }[] } | null;
  errorMessage: string | null;
  actorType: string;
}

export interface HarveyRunSnapshot {
  runId: string | null;
  campaignId: string;
  campaignName: string;
  country: string;
  timezone: string;
  workStartMinute: number;
  workEndMinute: number;
  cycleDate: string;
  status: 'RUNNING' | 'PAUSED' | 'STOPPED' | 'COMPLETED' | null;
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
  inProgress: HarveyActivity[];
  runs: HarveyRunSnapshot[];
  pendingApprovals: number;
  nextWorkStart: string | null;
  lastError: string | null;
}

export interface Campaign {
  id: string;
  name: string;
  status: 'ACTIVE' | 'ARCHIVED';
  country: string;
  regionLabel: string | null;
  language: string;
  timezone: string;
  workingDays: number[];
  workStartMinute: number;
  workEndMinute: number;
  dailyResearchGoal: number;
  dailyQualifiedGoal: number;
  dailyOutreachGoal: number;
  enabledChannels: string[];
  monthlyBudgetUsd: number | null;
}

export type CampaignPatch = Partial<Omit<Campaign, 'id'>>;

export const HARVEY_CONTROL_ROLES = ['OWNER', 'ADMIN'] as const;

// Mesmas transições da API (HARVEY_COMMAND_TRANSITIONS em shared-types).
export const COMMANDS_BY_STATE: Record<HarveyControlState, HarveyCommand[]> = {
  STOPPED: ['START'],
  ACTIVE: ['PAUSE', 'STOP'],
  PAUSED: ['RESUME', 'STOP'],
};

export const STATUS_LABELS: Record<HarveyDisplayStatus, string> = {
  IDLE: 'Aguardando',
  RUNNING: 'Trabalhando',
  RESEARCHING: 'Pesquisando empresas',
  QUALIFYING: 'Qualificando oportunidades',
  PREPARING_OUTREACH: 'Preparando abordagens',
  AWAITING_APPROVAL: 'Aguardando sua aprovação',
  SENDING: 'Enviando comunicação autorizada',
  RESPONDING: 'Tratando respostas',
  PAUSED: 'Pausado',
  STOPPED: 'Parado',
  ERROR: 'Com erro',
  COMPLETED: 'Concluiu o dia',
};

export const PHASE_LABELS: Record<HarveyPhase, string> = {
  RESEARCHING: 'Pesquisa',
  QUALIFYING: 'Qualificação',
  PREPARING_OUTREACH: 'Abordagem',
  SENDING: 'Envio',
  RESPONDING: 'Respostas',
  CONTROL: 'Controle',
};

export const ACTIVITY_STATUS_LABELS: Record<HarveyActivityStatus, string> = {
  STARTED: 'Em andamento',
  SUCCEEDED: 'Concluída',
  FAILED: 'Falhou',
  SKIPPED: 'Adiada',
  CANCELLED: 'Cancelada',
};

export const END_REASON_LABELS: Record<string, string> = {
  GOALS_MET: 'metas atingidas',
  HOURS_ENDED: 'fim do horário',
  STOPPED_BY_USER: 'parado manualmente',
  NO_WORK_AVAILABLE: 'sem mais trabalho disponível',
  BUDGET_EXCEEDED: 'orçamento atingido',
  DAY_ENDED_WHILE_PAUSED: 'o dia terminou pausado',
};

export const WEEKDAYS: { value: number; label: string }[] = [
  { value: 1, label: 'Seg' },
  { value: 2, label: 'Ter' },
  { value: 3, label: 'Qua' },
  { value: 4, label: 'Qui' },
  { value: 5, label: 'Sex' },
  { value: 6, label: 'Sáb' },
  { value: 7, label: 'Dom' },
];

export function minutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export function timeToMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

export function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h${String(minutes).padStart(2, '0')}` : `${minutes} min`;
}
