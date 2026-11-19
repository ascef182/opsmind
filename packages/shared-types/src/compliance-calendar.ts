import { addMonths, dateForMonthDay, monthOf } from './finance';

// Calendário de obrigações e certidões (OpsGov Fase 4). Datas 'YYYY-MM-DD'.

export const COMPLIANCE_OBLIGATION_TYPES = ['DAS', 'DASN_SIMEI', 'DEFIS', 'TAXA_MUNICIPAL', 'CERTIFICADO_DIGITAL', 'OUTRA'] as const;
export type ComplianceObligationType = (typeof COMPLIANCE_OBLIGATION_TYPES)[number];

export const OBLIGATION_RECURRENCES = ['MONTHLY', 'YEARLY', 'ONCE'] as const;
export type ObligationRecurrence = (typeof OBLIGATION_RECURRENCES)[number];

export type ObligationStatus = 'PENDENTE' | 'CUMPRIDA' | 'DISPENSADA';

export const CERTIFICATE_TYPES = ['CND_FEDERAL', 'ESTADUAL', 'MUNICIPAL', 'FGTS_CRF', 'CNDT_TRABALHISTA', 'FALENCIA'] as const;
export type CertificateType = (typeof CERTIFICATE_TYPES)[number];

export type CertificateStatus = 'VALIDA' | 'VENCENDO' | 'VENCIDA';

/** Certidão "vencendo" a partir de 15 dias do fim da validade. */
export const CERTIFICATE_EXPIRING_DAYS = 15;

/** Lembretes: obrigações em D-7 e D-1; certidões em D-15 e D-0. */
export const OBLIGATION_REMINDER_OFFSETS = [7, 1] as const;
export const CERTIFICATE_REMINDER_OFFSETS = [15, 0] as const;

const DAY_MS = 86_400_000;

/** Dias de `from` até `to` (negativo se `to` já passou). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

export function addDays(dateKey: string, days: number): string {
  return new Date(Date.parse(`${dateKey}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** A validade é inclusiva: no próprio dia `validUntil` a certidão ainda vale. */
export function certificateStatus(validUntil: string, today: string): CertificateStatus {
  const days = daysBetween(today, validUntil);
  if (days < 0) return 'VENCIDA';
  return days <= CERTIFICATE_EXPIRING_DAYS ? 'VENCENDO' : 'VALIDA';
}

export interface RecurrenceRule {
  recurrence: ObligationRecurrence;
  /** Dia do vencimento (1–31; dia inexistente cai no último do mês). */
  dueDay: number | null;
  /** Mês do vencimento (1–12), só YEARLY. */
  dueMonth: number | null;
}

/**
 * Próximo vencimento depois de cumprir o atual. ONCE não tem próximo (null).
 * Sempre a partir do vencimento cumprido, nunca de "hoje": pagar o DAS de
 * março com atraso não pula o de abril.
 */
export function nextDueDate(rule: RecurrenceRule, currentDueDate: string): string | null {
  if (rule.recurrence === 'ONCE') return null;
  const day = rule.dueDay ?? Number(currentDueDate.slice(8, 10));
  if (rule.recurrence === 'MONTHLY') return dateForMonthDay(addMonths(monthOf(currentDueDate), 1), day);
  const month = rule.dueMonth ?? Number(currentDueDate.slice(5, 7));
  const year = Number(currentDueDate.slice(0, 4)) + 1;
  return dateForMonthDay(`${year}-${String(month).padStart(2, '0')}`, day);
}

/**
 * Qual lembrete enviar hoje para um vencimento, dados os offsets (em dias
 * antes). Devolve o offset mais urgente já alcançado — se o scan ficou parado e
 * D-7 e D-1 já passaram, manda só D-1, sem rajada. A idempotência (não repetir
 * o mesmo offset) é do chamador, via ComplianceReminder.
 */
export function reminderOffsetDue(dueDate: string, today: string, offsets: readonly number[]): number | null {
  const daysLeft = daysBetween(today, dueDate);
  const reached = offsets.filter((offset) => daysLeft <= offset);
  return reached.length > 0 ? Math.min(...reached) : null;
}

/** Primeiro vencimento de uma regra recorrente a partir de hoje (inclusive). */
export function firstDueDateFrom(rule: RecurrenceRule, today: string): string | null {
  if (rule.recurrence === 'ONCE' || rule.dueDay === null) return null;
  const year = Number(today.slice(0, 4));
  const candidate =
    rule.recurrence === 'MONTHLY'
      ? dateForMonthDay(monthOf(today), rule.dueDay)
      : dateForMonthDay(`${year}-${String(rule.dueMonth ?? 1).padStart(2, '0')}`, rule.dueDay);
  return candidate >= today ? candidate : nextDueDate(rule, candidate);
}
