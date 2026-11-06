import type { AuditActorType } from '@opsmind/database';
import type {
  ContractBilling,
  ContractStatus,
  DisplayStatus,
  FinancialCategory,
  FinancialDirection,
  FinancialEntryStatus,
  FinancialScope,
  ForeignCurrency,
} from '@opsmind/shared-types';

export interface FinanceActor {
  type: AuditActorType;
  id: string;
}

export interface FinancialPaymentView {
  id: string;
  amountCents: number;
  paidAt: string;
  method: string | null;
  note: string | null;
  reversedAt: string | null;
  reverseReason: string | null;
}

// Forma exposta pela API: datas de negócio como 'YYYY-MM-DD', dinheiro em
// centavos, e os campos derivados (saldo, líquido, "atrasado") já calculados
// no servidor — o front nunca refaz essa conta.
export interface FinancialEntryView {
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
  payments?: FinancialPaymentView[];
}

export interface ContractView {
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
  createdAt: string;
  // Totais vitalícios do contrato (não de um período): o que foi cobrado,
  // quanto entrou e quanto falta.
  invoicedCents: number;
  receivedCents: number;
  outstandingCents: number;
}

export interface RecurringView {
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
