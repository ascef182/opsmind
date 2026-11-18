// Vigência dos registros do OpsGov: intervalo semiaberto [validFrom, validTo),
// datas 'YYYY-MM-DD' (comparáveis como string). validTo nulo = vigente.
// Nada é sobrescrito: uma mudança fecha o registro vigente na data em que o
// novo começa e abre o novo, na mesma transação (o service garante a
// atomicidade; o banco, a ausência de sobreposição via EXCLUDE USING gist).

export interface ValidityPeriod {
  validFrom: string;
  validTo: string | null;
}

export function isActiveAt(period: ValidityPeriod, date: string): boolean {
  return period.validFrom <= date && (period.validTo === null || date < period.validTo);
}

export function activeAt<T extends ValidityPeriod>(periods: readonly T[], date: string): T | null {
  return periods.find((p) => isActiveAt(p, date)) ?? null;
}

export function periodsOverlap(a: ValidityPeriod, b: ValidityPeriod): boolean {
  const aEndsAfterBStarts = a.validTo === null || b.validFrom < a.validTo;
  const bEndsAfterAStarts = b.validTo === null || a.validFrom < b.validTo;
  return aEndsAfterBStarts && bEndsAfterAStarts;
}

export type PeriodChangeRejection = 'NOT_AFTER_CURRENT_START' | 'OVERLAPS_FUTURE_PERIOD' | 'INVALID_RANGE';

export type PeriodChangePlan<T> =
  | { ok: true; close: { period: T; validTo: string } | null }
  | { ok: false; reason: PeriodChangeRejection };

/**
 * Decide como abrir um período novo a partir de `validFrom` dado o histórico
 * existente. Só aceita mudança "para a frente": o novo início precisa ser
 * posterior ao início do vigente (que é fechado nessa data) e não pode cair
 * sobre períodos já encerrados ou futuros. Correção retroativa exige um fluxo
 * próprio e auditado — nunca reescrever história em silêncio.
 */
export function planPeriodChange<T extends ValidityPeriod>(
  existing: readonly T[],
  next: ValidityPeriod,
): PeriodChangePlan<T> {
  if (next.validTo !== null && next.validTo <= next.validFrom) {
    return { ok: false, reason: 'INVALID_RANGE' };
  }

  const open = existing.find((p) => p.validTo === null) ?? null;
  if (open && next.validFrom <= open.validFrom) {
    return { ok: false, reason: 'NOT_AFTER_CURRENT_START' };
  }

  const closed = existing.filter((p) => p !== open);
  if (closed.some((p) => periodsOverlap(p, next))) {
    return { ok: false, reason: 'OVERLAPS_FUTURE_PERIOD' };
  }

  return { ok: true, close: open ? { period: open, validTo: next.validFrom } : null };
}

export const PERIOD_CHANGE_REJECTION_MESSAGES: Record<PeriodChangeRejection, string> = {
  NOT_AFTER_CURRENT_START: 'A nova vigência precisa começar depois do início do registro vigente',
  OVERLAPS_FUTURE_PERIOD: 'A nova vigência se sobrepõe a um período já registrado',
  INVALID_RANGE: 'O fim da vigência precisa ser posterior ao início',
};
