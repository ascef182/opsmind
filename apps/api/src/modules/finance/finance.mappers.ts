import type { Contract, FinancialEntry, FinancialPayment, RecurringEntry } from '@opsmind/database';
import {
  displayStatus,
  outstandingCents,
  toDateKey,
  type FinancialCategory,
  type FinancialEntryStatus,
  type FinancialScope,
  type ForeignCurrency,
} from '@opsmind/shared-types';
import type { ContractView, FinancialEntryView, FinancialPaymentView, RecurringView } from './finance.types';

export type EntryWithRelations = FinancialEntry & {
  customer?: { name: string } | null;
  contract?: { title: string } | null;
  payments?: FinancialPayment[];
};

export function toPaymentView(payment: FinancialPayment): FinancialPaymentView {
  return {
    id: payment.id,
    amountCents: payment.amountCents,
    paidAt: toDateKey(payment.paidAt),
    method: payment.method,
    note: payment.note,
    reversedAt: payment.reversedAt ? payment.reversedAt.toISOString() : null,
    reverseReason: payment.reverseReason,
  };
}

export function toEntryView(entry: EntryWithRelations, today: string): FinancialEntryView {
  const dueDate = toDateKey(entry.dueDate);
  return {
    id: entry.id,
    direction: entry.direction,
    category: entry.category as FinancialCategory,
    scope: entry.scope as FinancialScope,
    description: entry.description,
    supplierName: entry.supplierName,
    customerId: entry.customerId,
    customerName: entry.customer?.name ?? null,
    contractId: entry.contractId,
    contractTitle: entry.contract?.title ?? null,
    recurringEntryId: entry.recurringEntryId,
    referenceMonth: entry.referenceMonth,
    amountCents: entry.amountCents,
    feesCents: entry.feesCents,
    netCents: entry.amountCents - entry.feesCents,
    foreignCurrency: entry.foreignCurrency as ForeignCurrency | null,
    foreignAmountCents: entry.foreignAmountCents,
    exchangeRate: entry.exchangeRate ? entry.exchangeRate.toNumber() : null,
    iofCents: entry.iofCents,
    paidCents: entry.paidCents,
    outstandingCents: entry.status === 'CANCELLED' ? 0 : outstandingCents(entry),
    status: entry.status as FinancialEntryStatus,
    displayStatus: displayStatus({ ...entry, status: entry.status as FinancialEntryStatus, dueDate }, today),
    issueDate: toDateKey(entry.issueDate),
    dueDate,
    settledAt: entry.settledAt ? toDateKey(entry.settledAt) : null,
    cancelledAt: entry.cancelledAt ? entry.cancelledAt.toISOString() : null,
    cancelReason: entry.cancelReason,
    notes: entry.notes,
    createdAt: entry.createdAt.toISOString(),
    ...(entry.payments ? { payments: entry.payments.map(toPaymentView) } : {}),
  };
}

export function toContractView(
  contract: Contract & { customer?: { name: string } | null },
  totals: { invoicedCents: number; receivedCents: number; outstandingCents: number },
): ContractView {
  return {
    id: contract.id,
    customerId: contract.customerId,
    customerName: contract.customer?.name ?? null,
    dealId: contract.dealId,
    title: contract.title,
    category: contract.category as FinancialCategory,
    billing: contract.billing,
    status: contract.status,
    valueCents: contract.valueCents,
    startDate: toDateKey(contract.startDate),
    endDate: contract.endDate ? toDateKey(contract.endDate) : null,
    billingDay: contract.billingDay,
    notes: contract.notes,
    createdAt: contract.createdAt.toISOString(),
    ...totals,
  };
}

export function toRecurringView(r: RecurringEntry): RecurringView {
  return {
    id: r.id,
    direction: r.direction,
    category: r.category as FinancialCategory,
    scope: r.scope as FinancialScope,
    description: r.description,
    supplierName: r.supplierName,
    amountCents: r.amountCents,
    feesCents: r.feesCents,
    foreignCurrency: r.foreignCurrency as ForeignCurrency | null,
    foreignAmountCents: r.foreignAmountCents,
    dayOfMonth: r.dayOfMonth,
    startMonth: r.startMonth,
    endMonth: r.endMonth,
    active: r.active,
    customerId: r.customerId,
    contractId: r.contractId,
  };
}
