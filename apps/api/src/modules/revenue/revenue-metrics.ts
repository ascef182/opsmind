import {
  PIPELINE_NEXT_ACTION,
  PIPELINE_STAGE_LABEL,
  REVENUE_PIPELINE_STAGES,
  TERMINAL_PIPELINE_STAGES,
  pipelineStageIndex,
  type RevenuePipelineStage,
} from '@opsmind/shared-types';

export type RevenuePeriod = 'day' | 'week' | 'month';

const PERIOD_DAYS: Record<RevenuePeriod, number> = { day: 1, week: 7, month: 30 };
const MS_PER_DAY = 86_400_000;
const MS_PER_HOUR = 3_600_000;

export interface PeriodWindows {
  current: { start: Date; end: Date };
  previous: { start: Date; end: Date };
}

// Janelas móveis terminando agora: "dia" = últimas 24h contra as 24h
// anteriores. Evita o painel zerar à meia-noite UTC, que para quem opera no
// Brasil ou nos EUA cai no meio do expediente.
export function periodWindows(period: RevenuePeriod, now: Date): PeriodWindows {
  const length = PERIOD_DAYS[period] * MS_PER_DAY;
  const currentStart = new Date(now.getTime() - length);
  return {
    current: { start: currentStart, end: now },
    previous: { start: new Date(currentStart.getTime() - length), end: currentStart },
  };
}

export interface TransitionRow {
  leadId: string | null;
  dealId: string | null;
  toStage: string;
  occurredAt: Date;
}

export interface StageFlow {
  stage: RevenuePipelineStage;
  label: string;
  // Entidades que entraram no estágio dentro da janela analisada.
  entered: number;
  // Dessas, quantas chegaram depois a um estágio mais adiante no funil.
  progressed: number;
  // `progressed / entered`; null sem amostra. WON/LOST não têm "próximo".
  conversionRate: number | null;
  // Mediana de horas entre entrar no estágio e sair dele (só saídas já
  // ocorridas; quem ainda está parado no estágio não entra na conta).
  medianHoursInStage: number | null;
  nextAction: string;
}

function isFunnelStage(stage: string): stage is RevenuePipelineStage {
  return (REVENUE_PIPELINE_STAGES as readonly string[]).includes(stage);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

// O deal nascido de uma conversão carrega o `leadId` de origem, então lead e
// deal formam uma única trajetória no funil.
function entityKey(row: TransitionRow): string | null {
  if (row.leadId) return `lead:${row.leadId}`;
  if (row.dealId) return `deal:${row.dealId}`;
  return null;
}

export function computeStageFlows(transitions: TransitionRow[]): StageFlow[] {
  const byEntity = new Map<string, TransitionRow[]>();
  for (const row of transitions) {
    const key = entityKey(row);
    if (!key) continue;
    const list = byEntity.get(key) ?? [];
    list.push(row);
    byEntity.set(key, list);
  }

  const entered = new Map<RevenuePipelineStage, number>();
  const progressed = new Map<RevenuePipelineStage, number>();
  const durations = new Map<RevenuePipelineStage, number[]>();

  for (const rows of byEntity.values()) {
    rows.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
    const seen = new Set<RevenuePipelineStage>();
    rows.forEach((row, index) => {
      const next = rows[index + 1];
      if (isFunnelStage(row.toStage) && next) {
        const hours = (next.occurredAt.getTime() - row.occurredAt.getTime()) / MS_PER_HOUR;
        const list = durations.get(row.toStage) ?? [];
        list.push(hours);
        durations.set(row.toStage, list);
      }
      if (!isFunnelStage(row.toStage) || seen.has(row.toStage)) return;
      seen.add(row.toStage);
      entered.set(row.toStage, (entered.get(row.toStage) ?? 0) + 1);
      const stageIndex = pipelineStageIndex(row.toStage);
      const advancedLater = rows
        .slice(index + 1)
        .some(
          (later) =>
            isFunnelStage(later.toStage) &&
            later.toStage !== 'LOST' &&
            pipelineStageIndex(later.toStage) > stageIndex,
        );
      if (advancedLater) {
        progressed.set(row.toStage, (progressed.get(row.toStage) ?? 0) + 1);
      }
    });
  }

  return REVENUE_PIPELINE_STAGES.map((stage) => {
    const enteredCount = entered.get(stage) ?? 0;
    const progressedCount = progressed.get(stage) ?? 0;
    const terminal = TERMINAL_PIPELINE_STAGES.includes(stage);
    return {
      stage,
      label: PIPELINE_STAGE_LABEL[stage],
      entered: enteredCount,
      progressed: progressedCount,
      conversionRate: terminal || enteredCount === 0 ? null : progressedCount / enteredCount,
      medianHoursInStage: median(durations.get(stage) ?? []),
      nextAction: PIPELINE_NEXT_ACTION[stage],
    };
  });
}

export function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}
