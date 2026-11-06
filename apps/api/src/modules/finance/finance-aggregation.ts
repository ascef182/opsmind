// Agregações puras do módulo financeiro — recebem linhas já normalizadas
// (datas como 'YYYY-MM-DD') e devolvem números. Nenhum acesso a banco aqui, de
// propósito: é a parte onde um erro de conta passa despercebido por meses, e
// por isso é a parte mais coberta por testes (finance-aggregation.spec.ts).
//
// As três "receitas" nunca se misturam:
//   contracted  o que foi COMBINADO (contratos)
//   invoiced    o que foi COBRADO (lançamentos emitidos, por data de emissão)
//   received    o dinheiro que ENTROU (pagamentos, por data de pagamento)
// "Previsto" (PLANNED) é uma quarta coisa e também fica separada.
//
// Resultado realizado = recebido - taxas reconhecidas - despesas pagas.
// Taxas de um lançamento são reconhecidas quando ele é totalmente quitado
// (`settledAt`), não proporcionalmente a cada parcial — evita centavo
// quebrado e é fácil de conferir contra o extrato.

import {
  contractedCentsInRange,
  isOverdue,
  monthRange,
  monthsBetween,
  outstandingCents,
  quarterOf,
  type ContractTerms,
  type FinancialCategory,
  type FinancialDirection,
  type FinancialEntryStatus,
} from '@opsmind/shared-types';

export interface EntryRow {
  id: string;
  direction: FinancialDirection;
  category: FinancialCategory;
  customerId: string | null;
  contractId: string | null;
  amountCents: number;
  feesCents: number;
  paidCents: number;
  status: FinancialEntryStatus;
  issueDate: string;
  dueDate: string;
  settledAt: string | null;
}

export interface PaymentRow {
  entryId: string;
  amountCents: number;
  paidAt: string;
  direction: FinancialDirection;
  category: FinancialCategory;
  customerId: string | null;
  contractId: string | null;
}

export interface ContractRow extends ContractTerms {
  id: string;
  customerId: string;
  title: string;
}

const NOT_BILLED: FinancialEntryStatus[] = ['PLANNED', 'CANCELLED'];

const within = (value: string | null, from: string, to: string): boolean =>
  value !== null && value >= from && value <= to;

const sum = <T>(rows: T[], pick: (row: T) => number): number => rows.reduce((total, row) => total + pick(row), 0);

export interface PeriodSummary {
  from: string;
  to: string;
  contractedCents: number;
  invoicedCents: number;
  plannedIncomeCents: number;
  receivedCents: number;
  feesCents: number;
  expensesAccruedCents: number;
  expensesPlannedCents: number;
  expensesPaidCents: number;
  // Resultado de CAIXA realizado: recebido - taxas - despesas pagas.
  resultCents: number;
}

export function summarizePeriod(
  input: { entries: EntryRow[]; payments: PaymentRow[]; contracts: ContractRow[] },
  from: string,
  to: string,
): PeriodSummary {
  const { entries, payments, contracts } = input;
  const income = entries.filter((e) => e.direction === 'INCOME');
  const expense = entries.filter((e) => e.direction === 'EXPENSE');

  const contractedCents = sum(contracts, (c) => contractedCentsInRange(c, from, to));
  const invoicedCents = sum(
    income.filter((e) => !NOT_BILLED.includes(e.status) && within(e.issueDate, from, to)),
    (e) => e.amountCents,
  );
  const plannedIncomeCents = sum(
    income.filter((e) => e.status === 'PLANNED' && within(e.dueDate, from, to)),
    (e) => e.amountCents,
  );
  const receivedCents = sum(
    payments.filter((p) => p.direction === 'INCOME' && within(p.paidAt, from, to)),
    (p) => p.amountCents,
  );
  const feesCents = sum(
    income.filter((e) => e.status === 'PAID' && within(e.settledAt, from, to)),
    (e) => e.feesCents,
  );
  const expensesAccruedCents = sum(
    expense.filter((e) => !NOT_BILLED.includes(e.status) && within(e.issueDate, from, to)),
    (e) => e.amountCents,
  );
  const expensesPlannedCents = sum(
    expense.filter((e) => e.status === 'PLANNED' && within(e.dueDate, from, to)),
    (e) => e.amountCents,
  );
  const expensesPaidCents = sum(
    payments.filter((p) => p.direction === 'EXPENSE' && within(p.paidAt, from, to)),
    (p) => p.amountCents,
  );

  return {
    from,
    to,
    contractedCents,
    invoicedCents,
    plannedIncomeCents,
    receivedCents,
    feesCents,
    expensesAccruedCents,
    expensesPlannedCents,
    expensesPaidCents,
    resultCents: receivedCents - feesCents - expensesPaidCents,
  };
}

export interface OpenBalances {
  receivableOpenCents: number;
  receivableOverdueCents: number;
  receivableOverdueCount: number;
  payableOpenCents: number;
  payableOverdueCents: number;
  payableOverdueCount: number;
}

/** Saldo em aberto HOJE (independe do período do relatório). */
export function summarizeOpenBalances(entries: EntryRow[], today: string): OpenBalances {
  const open = entries.filter((e) => e.status === 'PENDING' || e.status === 'PARTIAL');
  const receivable = open.filter((e) => e.direction === 'INCOME');
  const payable = open.filter((e) => e.direction === 'EXPENSE');
  const overdue = (rows: EntryRow[]) => rows.filter((e) => isOverdue(e, today));
  return {
    receivableOpenCents: sum(receivable, outstandingCents),
    receivableOverdueCents: sum(overdue(receivable), outstandingCents),
    receivableOverdueCount: overdue(receivable).length,
    payableOpenCents: sum(payable, outstandingCents),
    payableOverdueCents: sum(overdue(payable), outstandingCents),
    payableOverdueCount: overdue(payable).length,
  };
}

export interface CategoryTotal {
  category: FinancialCategory;
  cents: number;
}

/** Dinheiro que entrou/saiu no período, por categoria, maior primeiro. */
export function totalsByCategory(
  payments: PaymentRow[],
  direction: FinancialDirection,
  from: string,
  to: string,
): CategoryTotal[] {
  const map = new Map<FinancialCategory, number>();
  for (const p of payments) {
    if (p.direction !== direction || !within(p.paidAt, from, to)) continue;
    map.set(p.category, (map.get(p.category) ?? 0) + p.amountCents);
  }
  return [...map.entries()]
    .map(([category, cents]) => ({ category, cents }))
    .sort((a, b) => b.cents - a.cents);
}

export interface MonthPoint extends PeriodSummary {
  month: string;
  quarter: 1 | 2 | 3 | 4;
}

export function monthlySeries(
  input: { entries: EntryRow[]; payments: PaymentRow[]; contracts: ContractRow[] },
  fromMonth: string,
  toMonth: string,
): MonthPoint[] {
  return monthsBetween(fromMonth, toMonth).map((month) => {
    const { from, to } = monthRange(month);
    return { month, quarter: quarterOf(month), ...summarizePeriod(input, from, to) };
  });
}

const ADDITIVE_KEYS = [
  'contractedCents',
  'invoicedCents',
  'plannedIncomeCents',
  'receivedCents',
  'feesCents',
  'expensesAccruedCents',
  'expensesPlannedCents',
  'expensesPaidCents',
  'resultCents',
] as const;

type Additive = Pick<PeriodSummary, (typeof ADDITIVE_KEYS)[number]>;

export function sumPoints(points: Additive[]): Additive {
  const total = Object.fromEntries(ADDITIVE_KEYS.map((k) => [k, 0])) as Additive;
  for (const point of points) for (const key of ADDITIVE_KEYS) total[key] += point[key];
  return total;
}

export interface QuarterPoint extends Additive {
  quarter: 1 | 2 | 3 | 4;
}

export function quarterlySeries(months: MonthPoint[]): QuarterPoint[] {
  return ([1, 2, 3, 4] as const)
    .map((quarter) => ({ quarter, ...sumPoints(months.filter((m) => m.quarter === quarter)) }))
    .filter((_, i) => months.some((m) => m.quarter === i + 1));
}

export interface ProfitabilityRow {
  key: string | null;
  contractedCents: number;
  invoicedCents: number;
  receivedCents: number;
  openCents: number;
  feesCents: number;
  costsCents: number;
  marginCents: number;
  // null quando não houve recebimento (margem % sobre zero não existe).
  marginPct: number | null;
}

/**
 * Rentabilidade por cliente ou por contrato. `key = null` agrupa o que não
 * está vinculado a ninguém (custos gerais como a VPS compartilhada) — aparece
 * como linha própria para o total fechar com o resultado do período em vez de
 * sumir.
 *
 * Margem = recebido - taxas reconhecidas - custos PAGOS vinculados.
 */
export function profitability(
  input: { entries: EntryRow[]; payments: PaymentRow[]; contracts: ContractRow[] },
  by: 'customer' | 'contract',
  from: string,
  to: string,
): ProfitabilityRow[] {
  const keyOfEntry = (e: { customerId: string | null; contractId: string | null }) =>
    by === 'customer' ? e.customerId : e.contractId;
  const keyOfContract = (c: ContractRow) => (by === 'customer' ? c.customerId : c.id);

  const rows = new Map<string | null, ProfitabilityRow>();
  const row = (key: string | null): ProfitabilityRow => {
    let r = rows.get(key);
    if (!r) {
      r = {
        key,
        contractedCents: 0,
        invoicedCents: 0,
        receivedCents: 0,
        openCents: 0,
        feesCents: 0,
        costsCents: 0,
        marginCents: 0,
        marginPct: null,
      };
      rows.set(key, r);
    }
    return r;
  };

  for (const c of input.contracts) {
    const cents = contractedCentsInRange(c, from, to);
    if (cents > 0) row(keyOfContract(c)).contractedCents += cents;
  }
  for (const e of input.entries) {
    const key = keyOfEntry(e);
    if (e.direction === 'INCOME') {
      if (!NOT_BILLED.includes(e.status) && within(e.issueDate, from, to)) row(key).invoicedCents += e.amountCents;
      if (e.status === 'PAID' && within(e.settledAt, from, to)) row(key).feesCents += e.feesCents;
      if (e.status === 'PENDING' || e.status === 'PARTIAL') row(key).openCents += outstandingCents(e);
    }
  }
  for (const p of input.payments) {
    if (!within(p.paidAt, from, to)) continue;
    const key = keyOfEntry(p);
    if (p.direction === 'INCOME') row(key).receivedCents += p.amountCents;
    else row(key).costsCents += p.amountCents;
  }

  const out = [...rows.values()].map((r) => {
    const marginCents = r.receivedCents - r.feesCents - r.costsCents;
    return {
      ...r,
      marginCents,
      marginPct: r.receivedCents > 0 ? Math.round((marginCents / r.receivedCents) * 1000) / 10 : null,
    };
  });
  // Maior recebimento primeiro; a linha "sem vínculo" sempre por último.
  return out.sort((a, b) => {
    if (a.key === null) return 1;
    if (b.key === null) return -1;
    return b.receivedCents - a.receivedCents || b.contractedCents - a.contractedCents;
  });
}

export interface ExpectedFlow {
  // O que se espera RECEBER / PAGAR com vencimento no período: saldo em aberto
  // dos lançamentos pendentes/parciais + valor cheio dos previstos (PLANNED).
  expectedInCents: number;
  expectedOutCents: number;
}

/** Fluxo de caixa PREVISTO de um período (o realizado está em summarizePeriod). */
export function expectedFlow(entries: EntryRow[], from: string, to: string): ExpectedFlow {
  const pending = entries.filter(
    (e) => within(e.dueDate, from, to) && (e.status === 'PENDING' || e.status === 'PARTIAL' || e.status === 'PLANNED'),
  );
  const open = (e: EntryRow) => (e.status === 'PLANNED' ? e.amountCents : outstandingCents(e));
  return {
    expectedInCents: sum(pending.filter((e) => e.direction === 'INCOME'), open),
    expectedOutCents: sum(pending.filter((e) => e.direction === 'EXPENSE'), open),
  };
}
