import type {
  ContractBilling,
  ContractStatus,
  DisplayStatus,
  FinancialCategory,
  FinancialDirection,
  FinancialEntryStatus,
  FinancialScope,
  ForeignCurrency,
  Role,
} from '@opsmind/shared-types';

export type {
  ContractBilling,
  ContractStatus,
  DisplayStatus,
  FinancialCategory,
  FinancialDirection,
  FinancialEntryStatus,
  FinancialScope,
  ForeignCurrency,
};

// Espelha FINANCE_READ_ROLE / FINANCE_WRITE_ROLE de
// apps/api/src/modules/finance/finance.constants.ts. Só esconde UI — quem
// decide de verdade é a API (RolesGuard).
export const FINANCE_READ_ROLES: Role[] = ['OWNER', 'ADMIN', 'MANAGER'];
export const FINANCE_WRITE_ROLES: Role[] = ['OWNER', 'ADMIN'];

export interface FinancialPayment {
  id: string;
  amountCents: number;
  paidAt: string;
  method: string | null;
  note: string | null;
  reversedAt: string | null;
  reverseReason: string | null;
}

export interface FinancialEntry {
  id: string;
  direction: FinancialDirection;
  category: FinancialCategory;
  scope: FinancialScope;
  description: string;
  supplierName: string | null;
  customerId: string | null;
  customerName: string | null;
  contractId: string | null;
  contractTitle: string | null;
  recurringEntryId: string | null;
  referenceMonth: string | null;
  amountCents: number;
  feesCents: number;
  netCents: number;
  foreignCurrency: ForeignCurrency | null;
  foreignAmountCents: number | null;
  exchangeRate: number | null;
  iofCents: number | null;
  paidCents: number;
  outstandingCents: number;
  status: FinancialEntryStatus;
  displayStatus: DisplayStatus;
  issueDate: string;
  dueDate: string;
  settledAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  notes: string | null;
  createdAt: string;
  payments?: FinancialPayment[];
}

export interface Contract {
  id: string;
  customerId: string;
  customerName: string | null;
  dealId: string | null;
  title: string;
  category: FinancialCategory;
  billing: ContractBilling;
  status: ContractStatus;
  valueCents: number;
  startDate: string;
  endDate: string | null;
  billingDay: number | null;
  notes: string | null;
  invoicedCents: number;
  receivedCents: number;
  outstandingCents: number;
}

export interface RecurringEntry {
  id: string;
  direction: FinancialDirection;
  category: FinancialCategory;
  scope: FinancialScope;
  description: string;
  supplierName: string | null;
  amountCents: number;
  feesCents: number;
  foreignCurrency: ForeignCurrency | null;
  foreignAmountCents: number | null;
  dayOfMonth: number;
  startMonth: string;
  endMonth: string | null;
  active: boolean;
  customerId: string | null;
  contractId: string | null;
}

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
  resultCents: number;
}

export interface OpenBalances {
  receivableOpenCents: number;
  receivableOverdueCents: number;
  receivableOverdueCount: number;
  payableOpenCents: number;
  payableOverdueCents: number;
  payableOverdueCount: number;
}

export interface CategoryTotal {
  category: FinancialCategory;
  cents: number;
}

export interface DueSoonItem {
  id: string;
  description: string;
  counterparty: string | null;
  dueDate: string;
  outstandingCents: number;
  overdue: boolean;
}

export interface PersonalBreakdown {
  summary: PeriodSummary;
  incomeByCategory: CategoryTotal[];
  expensesByCategory: CategoryTotal[];
}

export interface FinanceOverview {
  period: { from: string; to: string };
  today: string;
  summary: PeriodSummary;
  balances: OpenBalances;
  mrrCents: number;
  activeContracts: number;
  incomeByCategory: CategoryTotal[];
  expensesByCategory: CategoryTotal[];
  upcomingReceivables: DueSoonItem[];
  upcomingPayables: DueSoonItem[];
  wonDealsWithoutContract: Array<{ id: string; title: string; customerName: string; valueCents: number }>;
  personal: PersonalBreakdown;
}

export interface MonthReport extends PeriodSummary {
  month: string;
  quarter: 1 | 2 | 3 | 4;
  expectedInCents: number;
  expectedOutCents: number;
}

export interface AnnualReport {
  year: number;
  months: MonthReport[];
  quarters: Array<Omit<PeriodSummary, 'from' | 'to'> & { quarter: 1 | 2 | 3 | 4 }>;
  totals: PeriodSummary;
  balances: OpenBalances;
  incomeByCategory: CategoryTotal[];
  expensesByCategory: CategoryTotal[];
  topCustomers: Array<{ customerId: string | null; customerName: string; receivedCents: number }>;
  personal: PersonalBreakdown;
}

export interface ProfitabilityRow {
  key: string | null;
  label: string;
  sublabel: string | null;
  contractedCents: number;
  invoicedCents: number;
  receivedCents: number;
  openCents: number;
  feesCents: number;
  costsCents: number;
  marginCents: number;
  marginPct: number | null;
}

export interface ProfitabilityReport {
  period: { from: string; to: string };
  by: 'customer' | 'contract';
  rows: ProfitabilityRow[];
}

export interface EntryFilter {
  direction?: FinancialDirection;
  status?: DisplayStatus;
  category?: FinancialCategory;
  scope?: FinancialScope;
  customerId?: string;
  contractId?: string;
  from?: string;
  to?: string;
  search?: string;
}

export interface CreateEntryInput {
  direction: FinancialDirection;
  category: FinancialCategory;
  scope?: FinancialScope;
  description: string;
  supplierName?: string;
  customerId?: string;
  contractId?: string;
  amountCents: number;
  feesCents?: number;
  foreignCurrency?: ForeignCurrency;
  foreignAmountCents?: number;
  exchangeRate?: number;
  iofCents?: number;
  issueDate?: string;
  dueDate: string;
  status?: 'PLANNED' | 'PENDING';
  notes?: string;
}

// Reconciliação de câmbio/IOF de um mês específico — a única parte de
// UpdateEntryInput usada pelo formulário de "Câmbio" do lançamento; os
// outros campos existem pelo mesmo motivo que em CreateEntryInput (editar
// qualquer coisa do lançamento), mas não têm UI própria ainda.
export interface UpdateEntryInput {
  amountCents?: number;
  foreignCurrency?: ForeignCurrency | null;
  foreignAmountCents?: number | null;
  exchangeRate?: number | null;
  iofCents?: number | null;
}

export interface RegisterPaymentInput {
  amountCents: number;
  paidAt?: string;
  method?: string;
  note?: string;
}

export interface CreateContractInput {
  customerId: string;
  title: string;
  category: FinancialCategory;
  billing: ContractBilling;
  valueCents: number;
  startDate: string;
  endDate?: string;
  billingDay?: number;
  generateBilling?: boolean;
  firstDueDate?: string;
  notes?: string;
}

export interface CreateRecurringInput {
  direction: FinancialDirection;
  category: FinancialCategory;
  scope?: FinancialScope;
  description: string;
  supplierName?: string;
  amountCents: number;
  feesCents?: number;
  foreignCurrency?: ForeignCurrency;
  foreignAmountCents?: number;
  dayOfMonth: number;
  startMonth?: string;
  endMonth?: string;
  customerId?: string;
}

export interface UpdateRecurringInput {
  description?: string;
  supplierName?: string | null;
  amountCents?: number;
  foreignCurrency?: ForeignCurrency | null;
  foreignAmountCents?: number | null;
  dayOfMonth?: number;
  endMonth?: string | null;
  active?: boolean;
}
