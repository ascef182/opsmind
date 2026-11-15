// Regras puras do módulo financeiro — sem framework, sem I/O — usadas pela API
// (apps/api/src/modules/finance) e pelo front (formatação/parse de dinheiro).
// Mesmo racional de `lead-scoring.ts`: uma única implementação para que quem
// calcula e quem exibe nunca divirjam.
//
// CONVENÇÕES
//  * Dinheiro é sempre CENTAVOS INTEIROS (`number` inteiro). Nenhuma função
//    aqui aceita ou devolve reais em ponto flutuante, exceto `parseReaisToCents`
//    (entrada digitada) e `formatCentsBRL` (saída para a tela).
//  * Datas de negócio são strings `YYYY-MM-DD` (dia do calendário brasileiro),
//    meses são `YYYY-MM`. Strings comparam corretamente em ordem lexicográfica,
//    e evitam o bug clássico de fuso (meia-noite UTC virando "ontem" em
//    São Paulo).

export const FINANCE_TIMEZONE = 'America/Sao_Paulo';

export type FinancialDirection = 'INCOME' | 'EXPENSE';
export type FinancialEntryStatus = 'PLANNED' | 'PENDING' | 'PARTIAL' | 'PAID' | 'CANCELLED';
export type ContractBilling = 'ONE_TIME' | 'MONTHLY';
export type ContractStatus = 'ACTIVE' | 'COMPLETED' | 'CANCELLED';

// Dono do lançamento: CNPJ (empresa) ou pessoa física. Default é sempre
// BUSINESS — todo o histórico anterior a este campo é da empresa. Relatórios
// (overview/annual/profitability) só somam BUSINESS por padrão; PERSONAL
// aparece separado, nunca misturado no resultado "oficial".
export type FinancialScope = 'BUSINESS' | 'PERSONAL';

export const FINANCIAL_SCOPE_LABELS: Record<FinancialScope, string> = {
  BUSINESS: 'Empresa (CNPJ)',
  PERSONAL: 'Pessoal',
};

// Moeda estrangeira nominal de um lançamento/molde (ex.: assinatura cobrada
// em USD). BRL nunca aparece aqui — é o padrão implícito de amountCents.
export type ForeignCurrency = 'USD';

export const FOREIGN_CURRENCY_LABELS: Record<ForeignCurrency, string> = {
  USD: 'Dólar (US$)',
};

export const INCOME_CATEGORIES = [
  'IMPLEMENTATION',
  'PROJECT',
  'DEVELOPMENT',
  'CONSULTING',
  'MONTHLY_FEE',
  'SAAS',
  'RECURRING_CONTRACT',
  'ADDITIONAL_SERVICE',
  'OTHER_INCOME',
  'PRODUCT_SALE',
  'PERSONAL_ASSET_SALE',
] as const;

export const EXPENSE_CATEGORIES = [
  'INFRASTRUCTURE',
  'DOMAINS',
  'APIS',
  'AI',
  'WHATSAPP',
  'TOOLS',
  'MARKETING',
  'TAXES',
  'SUPPLIERS',
  'OPERATIONAL',
  'OTHER_EXPENSE',
] as const;

export type IncomeCategory = (typeof INCOME_CATEGORIES)[number];
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export type FinancialCategory = IncomeCategory | ExpenseCategory;

export const FINANCIAL_CATEGORY_LABELS: Record<FinancialCategory, string> = {
  IMPLEMENTATION: 'Implantação',
  PROJECT: 'Projeto',
  DEVELOPMENT: 'Desenvolvimento',
  CONSULTING: 'Consultoria',
  MONTHLY_FEE: 'Mensalidade',
  SAAS: 'SaaS',
  RECURRING_CONTRACT: 'Contrato recorrente',
  ADDITIONAL_SERVICE: 'Serviço adicional',
  OTHER_INCOME: 'Outras receitas',
  PRODUCT_SALE: 'Venda de produto',
  PERSONAL_ASSET_SALE: 'Venda de bem pessoal',
  INFRASTRUCTURE: 'Infraestrutura (VPS)',
  DOMAINS: 'Domínios',
  APIS: 'APIs',
  AI: 'IA (OpenAI/Claude)',
  WHATSAPP: 'WhatsApp',
  TOOLS: 'Ferramentas',
  MARKETING: 'Marketing',
  TAXES: 'Impostos',
  SUPPLIERS: 'Fornecedores',
  OPERATIONAL: 'Operacionais',
  OTHER_EXPENSE: 'Outras despesas',
};

export const CATEGORY_DIRECTION: Record<FinancialCategory, FinancialDirection> = {
  ...(Object.fromEntries(INCOME_CATEGORIES.map((c) => [c, 'INCOME'])) as Record<IncomeCategory, 'INCOME'>),
  ...(Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c, 'EXPENSE'])) as Record<ExpenseCategory, 'EXPENSE'>),
};

export function isCategoryOfDirection(category: FinancialCategory, direction: FinancialDirection): boolean {
  return CATEGORY_DIRECTION[category] === direction;
}

// ── Dinheiro ───────────────────────────────────────────────────────────────

/**
 * Valor digitado (reais) -> centavos. Desambigua sem adivinhar, porque em
 * pt-BR um grupo de milhar tem SEMPRE 3 dígitos:
 *   "249,90" -> 24990 · "249.90" -> 24990 · "1.234" -> 123400
 *   "1.234,56" -> 123456 · "1,234.56" -> 123456 (formato en)
 * Ideia herdada do `parseReaisToCents` do DeskcommCRM (MIT) — reescrita aqui.
 * Devolve null quando não dá para ler um número não negativo.
 */
export function parseReaisToCents(input: string): number | null {
  const raw = input.replace(/^R\$\s*/i, '').trim();
  if (raw.length === 0 || !/^[\d.,\s]+$/.test(raw)) return null;

  const s = raw.replace(/\s/g, '');
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');

  let decimalSep = '';
  if (lastComma >= 0 && lastDot >= 0) {
    decimalSep = lastComma > lastDot ? ',' : '.';
  } else if (lastComma >= 0) {
    decimalSep = ',';
  } else if (lastDot >= 0) {
    decimalSep = s.length - lastDot - 1 === 3 ? '' : '.';
  }

  let normalized: string;
  if (decimalSep === '') {
    normalized = s.replace(/[.,]/g, '');
  } else {
    const cut = decimalSep === ',' ? lastComma : lastDot;
    const integerPart = s.slice(0, cut).replace(/[.,]/g, '');
    const fraction = s.slice(cut + 1);
    if (!/^\d*$/.test(fraction)) return null;
    normalized = `${integerPart || '0'}.${fraction}`;
  }

  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

/**
 * Sugestão de quanto um valor em moeda estrangeira deveria ter dado em reais,
 * dada a cotação e o IOF do dia — SÓ uma sugestão para pré-preencher o campo
 * de valor; a cotação em si vem de fora (e-mail/extrato), nunca é buscada
 * automaticamente por este sistema. O valor final gravado é sempre o que o
 * usuário confirmar, nunca o resultado desta função sem revisão.
 */
export function estimateBrlFromForeign(foreignAmountCents: number, exchangeRate: number, iofCents = 0): number {
  return Math.round(foreignAmountCents * exchangeRate) + iofCents;
}

export function formatCentsBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// ── Datas e meses ──────────────────────────────────────────────────────────

const DATE_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MONTH_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isValidMonthKey(value: string): boolean {
  return MONTH_KEY_RE.test(value);
}

export function isValidDateKey(value: string): boolean {
  if (!DATE_KEY_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  return d <= lastDayOfMonth(y, m);
}

export function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** `Date` (coluna DATE do Postgres, meia-noite UTC) -> 'YYYY-MM-DD'. */
export function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD' -> `Date` em meia-noite UTC, a forma que o Prisma grava em DATE. */
export function fromDateKey(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

/** Hoje no calendário de São Paulo, independente do fuso do servidor. */
export function todayInSaoPaulo(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: FINANCE_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function monthOf(dateKey: string): string {
  return dateKey.slice(0, 7);
}

export function addMonths(monthKey: string, delta: number): string {
  const [y, m] = monthKey.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Meses de `from` a `to`, inclusive, em ordem. Vazio se `to < from`. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m);
  return out;
}

export function monthRange(monthKey: string): { from: string; to: string } {
  const [y, m] = monthKey.split('-').map(Number) as [number, number];
  return { from: `${monthKey}-01`, to: `${monthKey}-${String(lastDayOfMonth(y, m)).padStart(2, '0')}` };
}

export function quarterOf(monthKey: string): 1 | 2 | 3 | 4 {
  const m = Number(monthKey.slice(5, 7));
  return (Math.floor((m - 1) / 3) + 1) as 1 | 2 | 3 | 4;
}

/**
 * Data de cobrança de um mês: o dia pedido, ou o ÚLTIMO dia do mês quando ele
 * não existe (dia 31 em fevereiro). Pular o mês deixaria de cobrar; antecipar
 * para o dia 1 do seguinte mudaria a competência.
 */
export function dateForMonthDay(monthKey: string, day: number): string {
  const [y, m] = monthKey.split('-').map(Number) as [number, number];
  const clamped = Math.min(day, lastDayOfMonth(y, m));
  return `${monthKey}-${String(clamped).padStart(2, '0')}`;
}

// ── Lançamentos ────────────────────────────────────────────────────────────

export interface EntryAmounts {
  amountCents: number;
  paidCents: number;
}

export function outstandingCents(entry: EntryAmounts): number {
  return Math.max(entry.amountCents - entry.paidCents, 0);
}

/** Status que decorre dos valores. PLANNED/CANCELLED só mudam por ação explícita. */
export function statusFromPaid(
  entry: EntryAmounts,
  fallbackUnpaid: Extract<FinancialEntryStatus, 'PLANNED' | 'PENDING'> = 'PENDING',
): Extract<FinancialEntryStatus, 'PLANNED' | 'PENDING' | 'PARTIAL' | 'PAID'> {
  if (entry.paidCents <= 0) return fallbackUnpaid;
  if (entry.paidCents >= entry.amountCents) return 'PAID';
  return 'PARTIAL';
}

/** "Atrasado" é derivado: venceu antes de hoje e ainda há saldo. PLANNED não conta. */
export function isOverdue(
  entry: EntryAmounts & { status: FinancialEntryStatus; dueDate: string },
  today: string,
): boolean {
  if (entry.status !== 'PENDING' && entry.status !== 'PARTIAL') return false;
  return entry.dueDate < today && outstandingCents(entry) > 0;
}

export type DisplayStatus = FinancialEntryStatus | 'OVERDUE';

export function displayStatus(
  entry: EntryAmounts & { status: FinancialEntryStatus; dueDate: string },
  today: string,
): DisplayStatus {
  return isOverdue(entry, today) ? 'OVERDUE' : entry.status;
}

// ── Contratos ──────────────────────────────────────────────────────────────

export interface ContractTerms {
  billing: ContractBilling;
  status: ContractStatus;
  valueCents: number;
  startDate: string;
  endDate: string | null;
  billingDay: number | null;
}

/** Primeiro mês cuja data de cobrança cai em/depois do início do contrato. */
export function firstBillingMonth(startDate: string, billingDay: number): string {
  const startMonth = monthOf(startDate);
  return dateForMonthDay(startMonth, billingDay) >= startDate ? startMonth : addMonths(startMonth, 1);
}

/**
 * Receita CONTRATADA que cai em [from, to] (datas 'YYYY-MM-DD').
 *  - ONE_TIME: o valor inteiro, no período que contém a data de início.
 *  - MONTHLY: uma mensalidade por data de cobrança dentro de [início, fim]
 *    e dentro do período.
 * Contrato CANCELLED não entra. É o que foi COMBINADO — não o que foi
 * cobrado nem o que foi recebido.
 */
export function contractedCentsInRange(contract: ContractTerms, from: string, to: string): number {
  if (contract.status === 'CANCELLED') return 0;
  if (contract.billing === 'ONE_TIME') {
    return contract.startDate >= from && contract.startDate <= to ? contract.valueCents : 0;
  }
  if (contract.billingDay === null) return 0;
  const first = firstBillingMonth(contract.startDate, contract.billingDay);
  const lastMonth = contract.endDate ? monthOf(contract.endDate) : monthOf(to);
  let total = 0;
  for (const month of monthsBetween(first, lastMonth)) {
    const due = dateForMonthDay(month, contract.billingDay);
    if (due < contract.startDate) continue;
    if (contract.endDate && due > contract.endDate) continue;
    if (due >= from && due <= to) total += contract.valueCents;
  }
  return total;
}

/** MRR: soma das mensalidades de contratos MONTHLY ATIVOS e vigentes hoje. */
export function monthlyRecurringCents(contracts: ContractTerms[], today: string): number {
  return contracts
    .filter(
      (c) =>
        c.billing === 'MONTHLY' &&
        c.status === 'ACTIVE' &&
        c.startDate <= today &&
        (c.endDate === null || c.endDate >= today),
    )
    .reduce((sum, c) => sum + c.valueCents, 0);
}

// ── Recorrência ────────────────────────────────────────────────────────────

export interface RecurringTerms {
  active: boolean;
  dayOfMonth: number;
  startMonth: string;
  endMonth: string | null;
}

/** Meses em que o molde deve ter gerado lançamento, até `upToMonth` inclusive. */
export function monthsDueForRecurring(template: RecurringTerms, upToMonth: string): string[] {
  if (!template.active) return [];
  const last = template.endMonth && template.endMonth < upToMonth ? template.endMonth : upToMonth;
  return monthsBetween(template.startMonth, last);
}

/**
 * Data de emissão de um lançamento gerado por molde: o vencimento, mas nunca
 * no futuro — a cobrança do dia 25 gerada no dia 6 está "emitida hoje", não em
 * uma data que ainda não chegou (o que inflaria o faturado do mês corrente).
 */
export function recurringIssueDate(dueDate: string, today: string): string {
  return dueDate <= today ? dueDate : today;
}
