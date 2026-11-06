import { formatCentsBRL, parseReaisToCents, type DisplayStatus, type ForeignCurrency } from '@opsmind/shared-types';

export const brl = formatCentsBRL;

const FOREIGN_LOCALE: Record<ForeignCurrency, string> = { USD: 'en-US' };

export function fmtForeign(cents: number, currency: ForeignCurrency): string {
  return (cents / 100).toLocaleString(FOREIGN_LOCALE[currency], { style: 'currency', currency });
}

/** 'YYYY-MM-DD' -> 'DD/MM/AAAA' sem passar por Date (evita deslocar o dia por fuso). */
export function fmtDate(key: string | null | undefined): string {
  if (!key) return '—';
  const [y, m, d] = key.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export function fmtMonth(key: string): string {
  const [y, m] = key.split('-');
  return `${MONTHS[Number(m) - 1]}/${y}`;
}

export function currentMonthKey(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' })
    .formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}`;
}

export function todayKey(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

export function shiftMonth(key: string, delta: number): string {
  const [y = 0, m = 1] = key.split('-').map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

export const STATUS_LABEL: Record<DisplayStatus, string> = {
  PLANNED: 'Previsto',
  PENDING: 'Pendente',
  PARTIAL: 'Parcial',
  PAID: 'Quitado',
  CANCELLED: 'Cancelado',
  OVERDUE: 'Atrasado',
};

export const STATUS_CLASS: Record<DisplayStatus, string> = {
  PLANNED: 'bg-ink-800 text-ink-300',
  PENDING: 'bg-info-500/15 text-info-500',
  PARTIAL: 'bg-accent-500/15 text-accent-500',
  PAID: 'bg-positive-500/15 text-positive-500',
  CANCELLED: 'bg-ink-800 text-ink-300 line-through',
  OVERDUE: 'bg-negative-500/15 text-negative-500',
};

/** Texto digitado em R$ -> centavos, ou null se inválido/≤0. */
export function reaisToCents(input: string): number | null {
  const cents = parseReaisToCents(input);
  return cents !== null && cents > 0 ? cents : null;
}

export function centsToReaisInput(cents: number): string {
  return `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, '0')}`;
}
