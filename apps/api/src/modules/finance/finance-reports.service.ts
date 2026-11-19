import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '@opsmind/database';
import {
  FINANCE_TIMEZONE,
  fromDateKey,
  monthlyRecurringCents,
  monthOf,
  monthRange,
  outstandingCents,
  toDateKey,
  todayInSaoPaulo,
  type FinancialCategory,
  type FinancialScope,
} from '@opsmind/shared-types';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import {
  expectedFlow,
  monthlySeries,
  profitability,
  quarterlySeries,
  summarizeOpenBalances,
  summarizePeriod,
  sumPoints,
  totalsByCategory,
  type CategoryTotal,
  type ContractRow,
  type EntryRow,
  type ExpectedFlow,
  type MonthPoint,
  type OpenBalances,
  type PaymentRow,
  type PeriodSummary,
  type ProfitabilityRow,
  type QuarterPoint,
} from './finance-aggregation';
import type { OverviewQueryDto, ProfitabilityQueryDto } from './dto/report.dto';

const MAX_PERIOD_YEARS = 5;
const UPCOMING_LIMIT = 5;

export interface DueSoonItem {
  id: string;
  description: string;
  counterparty: string | null;
  dueDate: string;
  outstandingCents: number;
  overdue: boolean;
}

// O que entrou/saiu PESSOAL no período — nunca somado ao `summary`/`balances`
// principais (esses são só BUSINESS). Sem saldo em aberto/MRR: o pessoal não
// tem contrato nem conta a receber, só o que já foi lançado e pago.
export interface PersonalBreakdown {
  summary: PeriodSummary;
  incomeByCategory: CategoryTotal[];
  expensesByCategory: CategoryTotal[];
}

export interface FinanceOverview {
  period: { from: string; to: string };
  today: string;
  timezone: string;
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

export interface AnnualReport {
  year: number;
  months: Array<MonthPoint & ExpectedFlow>;
  quarters: QuarterPoint[];
  totals: PeriodSummary;
  balances: OpenBalances;
  incomeByCategory: CategoryTotal[];
  expensesByCategory: CategoryTotal[];
  topCustomers: Array<{ customerId: string | null; customerName: string; receivedCents: number }>;
  personal: PersonalBreakdown;
}

export interface ProfitabilityReport {
  period: { from: string; to: string };
  by: 'customer' | 'contract';
  rows: Array<ProfitabilityRow & { label: string; sublabel: string | null }>;
}

interface Dataset {
  entries: Array<EntryRow & { companyActivityId: string | null }>;
  payments: Array<PaymentRow & { companyActivityId: string | null }>;
  contracts: ContractRow[];
}

/** Receita da empresa (BUSINESS/INCOME) com a atividade de cada lançamento — base do OpsGov. */
export interface BusinessIncomeDataset {
  entries: Dataset['entries'];
  payments: Dataset['payments'];
}

/**
 * Leituras agregadas do financeiro. As contas em si moram em
 * finance-aggregation.ts (puras, testadas); aqui só se busca e normaliza.
 * Em volume de uma consultoria/software house (centenas de lançamentos por
 * ano) a agregação em memória é mais simples de auditar que SQL — se o volume
 * crescer ordens de grandeza, o ponto de troca é este arquivo.
 */
@Injectable()
export class FinanceReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(organizationId: string, query: OverviewQueryDto): Promise<FinanceOverview> {
    const today = todayInSaoPaulo();
    const period = this.resolvePeriod(query, today);
    const data = await this.loadDataset(organizationId, period.from, period.to, 'BUSINESS');
    const names = await this.counterpartyNames(organizationId, data.entries);
    const personal = await this.personalBreakdown(organizationId, period.from, period.to);

    const open = data.entries.filter((e) => e.status === 'PENDING' || e.status === 'PARTIAL');
    const dueSoon = (direction: 'INCOME' | 'EXPENSE'): DueSoonItem[] =>
      open
        .filter((e) => e.direction === direction)
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
        .slice(0, UPCOMING_LIMIT)
        .map((e) => ({
          id: e.id,
          description: names.descriptions.get(e.id) ?? '',
          counterparty: e.customerId ? (names.customers.get(e.customerId) ?? null) : (names.suppliers.get(e.id) ?? null),
          dueDate: e.dueDate,
          outstandingCents: outstandingCents(e),
          overdue: e.dueDate < today,
        }));

    const wonDeals = await this.prisma.deal.findMany({
      where: {
        organizationId,
        stage: 'WON',
        deletedAt: null,
        currency: 'BRL',
        contracts: { none: { status: { not: 'CANCELLED' } } },
      },
      include: { customer: { select: { name: true } } },
      orderBy: { actualCloseDate: 'desc' },
      take: UPCOMING_LIMIT,
    });

    return {
      period,
      today,
      timezone: FINANCE_TIMEZONE,
      summary: summarizePeriod(data, period.from, period.to),
      balances: summarizeOpenBalances(data.entries, today),
      mrrCents: monthlyRecurringCents(data.contracts, today),
      activeContracts: data.contracts.filter((c) => c.status === 'ACTIVE').length,
      incomeByCategory: totalsByCategory(data.payments, 'INCOME', period.from, period.to),
      expensesByCategory: totalsByCategory(data.payments, 'EXPENSE', period.from, period.to),
      upcomingReceivables: dueSoon('INCOME'),
      upcomingPayables: dueSoon('EXPENSE'),
      wonDealsWithoutContract: wonDeals.map((d) => ({
        id: d.id,
        title: d.title,
        customerName: d.customer.name,
        valueCents: Math.round(Number(d.value) * 100),
      })),
      personal,
    };
  }

  async annual(organizationId: string, year: number | undefined): Promise<AnnualReport> {
    const today = todayInSaoPaulo();
    const reportYear = year ?? Number(today.slice(0, 4));
    const from = `${reportYear}-01-01`;
    const to = `${reportYear}-12-31`;
    const data = await this.loadDataset(organizationId, from, to, 'BUSINESS');
    const personal = await this.personalBreakdown(organizationId, from, to);

    const months = monthlySeries(data, `${reportYear}-01`, `${reportYear}-12`).map((point) => {
      const range = monthRange(point.month);
      return { ...point, ...expectedFlow(data.entries, range.from, range.to) };
    });
    const totals = { from, to, ...sumPoints(months) } as PeriodSummary;

    const received = new Map<string | null, number>();
    for (const p of data.payments) {
      if (p.direction !== 'INCOME' || p.paidAt < from || p.paidAt > to) continue;
      received.set(p.customerId, (received.get(p.customerId) ?? 0) + p.amountCents);
    }
    const customerIds = [...received.keys()].filter((id): id is string => id !== null);
    const customers = customerIds.length
      ? await this.prisma.customer.findMany({
          where: { organizationId, id: { in: customerIds } },
          select: { id: true, name: true },
        })
      : [];
    const nameOf = new Map(customers.map((c) => [c.id, c.name]));

    return {
      year: reportYear,
      months,
      quarters: quarterlySeries(months),
      totals,
      balances: summarizeOpenBalances(data.entries, today),
      incomeByCategory: totalsByCategory(data.payments, 'INCOME', from, to),
      expensesByCategory: totalsByCategory(data.payments, 'EXPENSE', from, to),
      topCustomers: [...received.entries()]
        .map(([customerId, receivedCents]) => ({
          customerId,
          customerName: customerId ? (nameOf.get(customerId) ?? 'Cliente removido') : 'Sem cliente vinculado',
          receivedCents,
        }))
        .sort((a, b) => b.receivedCents - a.receivedCents)
        .slice(0, 10),
      personal,
    };
  }

  async profitability(organizationId: string, query: ProfitabilityQueryDto): Promise<ProfitabilityReport> {
    const today = todayInSaoPaulo();
    const period = this.resolvePeriod(query, today, 'year');
    const by = query.by ?? 'customer';
    const data = await this.loadDataset(organizationId, period.from, period.to, 'BUSINESS');
    const rows = profitability(data, by, period.from, period.to);

    const keys = rows.map((r) => r.key).filter((k): k is string => k !== null);
    const labels = new Map<string, { label: string; sublabel: string | null }>();
    if (by === 'customer' && keys.length) {
      const customers = await this.prisma.customer.findMany({
        where: { organizationId, id: { in: keys } },
        select: { id: true, name: true, company: true },
      });
      for (const c of customers) labels.set(c.id, { label: c.name, sublabel: c.company });
    } else if (by === 'contract' && keys.length) {
      const contracts = await this.prisma.contract.findMany({
        where: { organizationId, id: { in: keys } },
        select: { id: true, title: true, customer: { select: { name: true } } },
      });
      for (const c of contracts) labels.set(c.id, { label: c.title, sublabel: c.customer.name });
    }

    return {
      period,
      by,
      rows: rows.map((r) => ({
        ...r,
        label: r.key ? (labels.get(r.key)?.label ?? 'Registro removido') : 'Custos e receitas sem vínculo',
        sublabel: r.key ? (labels.get(r.key)?.sublabel ?? null) : null,
      })),
    };
  }

  // ── carga de dados ───────────────────────────────────────────────────────

  private resolvePeriod(
    query: OverviewQueryDto,
    today: string,
    fallback: 'month' | 'year' = 'month',
  ): { from: string; to: string } {
    if (query.from || query.to) {
      if (!query.from || !query.to) throw new BadRequestException('Informe from e to juntos');
      if (query.from > query.to) throw new BadRequestException('from não pode ser depois de to');
      const maxEnd = fromDateKey(query.from);
      maxEnd.setUTCFullYear(maxEnd.getUTCFullYear() + MAX_PERIOD_YEARS);
      if (fromDateKey(query.to) > maxEnd) {
        throw new BadRequestException(`O período não pode passar de ${MAX_PERIOD_YEARS} anos`);
      }
      return { from: query.from, to: query.to };
    }
    if (query.month) return monthRange(query.month);
    if (fallback === 'year') return { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` };
    return monthRange(monthOf(today));
  }

  /**
   * Faturamento da empresa para o OpsGov (receita por atividade, RBT12). Mesmo
   * carregamento e normalização dos relatórios — PERSONAL nunca entra.
   */
  async businessIncomeDataset(organizationId: string, from: string, to: string): Promise<BusinessIncomeDataset> {
    const data = await this.loadDataset(organizationId, from, to, 'BUSINESS');
    return {
      entries: data.entries.filter((e) => e.direction === 'INCOME'),
      payments: data.payments.filter((p) => p.direction === 'INCOME'),
    };
  }

  /**
   * Linhas relevantes para [from, to]: lançamentos que tocam o período (por
   * emissão, vencimento ou quitação) MAIS todos os ainda em aberto (precisam
   * para saldo a receber/pagar e para o "em aberto" da rentabilidade).
   */
  private async loadDataset(organizationId: string, from: string, to: string, scope: FinancialScope): Promise<Dataset> {
    const range = { gte: fromDateKey(from), lte: fromDateKey(to) };
    const entrySelect = {
      id: true,
      direction: true,
      category: true,
      customerId: true,
      contractId: true,
      amountCents: true,
      feesCents: true,
      paidCents: true,
      status: true,
      issueDate: true,
      dueDate: true,
      settledAt: true,
      companyActivityId: true,
    } satisfies Prisma.FinancialEntrySelect;

    const [entries, payments, contracts] = await Promise.all([
      this.prisma.financialEntry.findMany({
        where: {
          organizationId,
          scope,
          OR: [
            { issueDate: range },
            { dueDate: range },
            { settledAt: range },
            { status: { in: ['PENDING', 'PARTIAL'] } },
          ],
        },
        select: entrySelect,
      }),
      this.prisma.financialPayment.findMany({
        where: { organizationId, reversedAt: null, paidAt: range, entry: { scope } },
        select: {
          entryId: true,
          amountCents: true,
          paidAt: true,
          entry: { select: { direction: true, category: true, customerId: true, contractId: true, companyActivityId: true } },
        },
      }),
      // Contrato é sempre da empresa (representa receita combinada com um
      // cliente) — nunca entra no dataset PERSONAL, então nem vale a pena
      // buscar: evita que `contractedCents` da empresa vaze pro bloco pessoal.
      scope === 'PERSONAL'
        ? Promise.resolve([])
        : this.prisma.contract.findMany({
            where: { organizationId, status: { not: 'CANCELLED' } },
            select: {
              id: true,
              customerId: true,
              title: true,
              billing: true,
              status: true,
              valueCents: true,
              startDate: true,
              endDate: true,
              billingDay: true,
            },
          }),
    ]);

    return {
      entries: entries.map((e) => ({
        ...e,
        category: e.category as FinancialCategory,
        issueDate: toDateKey(e.issueDate),
        dueDate: toDateKey(e.dueDate),
        settledAt: e.settledAt ? toDateKey(e.settledAt) : null,
      })),
      payments: payments.map((p) => ({
        entryId: p.entryId,
        amountCents: p.amountCents,
        paidAt: toDateKey(p.paidAt),
        direction: p.entry.direction,
        category: p.entry.category as FinancialCategory,
        customerId: p.entry.customerId,
        contractId: p.entry.contractId,
        companyActivityId: p.entry.companyActivityId,
      })),
      contracts: contracts.map((c) => ({
        ...c,
        startDate: toDateKey(c.startDate),
        endDate: c.endDate ? toDateKey(c.endDate) : null,
      })),
    };
  }

  /**
   * O que entrou/saiu PESSOAL no período — nunca somado aos KPIs principais
   * (esses são só BUSINESS, ver `loadDataset`). Reaproveita as mesmas funções
   * puras de `summarizePeriod`/`totalsByCategory`, só que sobre o dataset
   * filtrado por `scope: 'PERSONAL'`.
   */
  private async personalBreakdown(organizationId: string, from: string, to: string): Promise<PersonalBreakdown> {
    const data = await this.loadDataset(organizationId, from, to, 'PERSONAL');
    return {
      summary: summarizePeriod(data, from, to),
      incomeByCategory: totalsByCategory(data.payments, 'INCOME', from, to),
      expensesByCategory: totalsByCategory(data.payments, 'EXPENSE', from, to),
    };
  }

  private async counterpartyNames(organizationId: string, entries: EntryRow[]) {
    const open = entries.filter((e) => e.status === 'PENDING' || e.status === 'PARTIAL');
    const ids = open.map((e) => e.id);
    const rows = ids.length
      ? await this.prisma.financialEntry.findMany({
          where: { organizationId, id: { in: ids } },
          select: { id: true, description: true, supplierName: true, customer: { select: { id: true, name: true } } },
        })
      : [];
    const descriptions = new Map(rows.map((r) => [r.id, r.description]));
    const suppliers = new Map(rows.filter((r) => r.supplierName).map((r) => [r.id, r.supplierName as string]));
    const customers = new Map(
      rows.filter((r) => r.customer).map((r) => [r.customer!.id, r.customer!.name]),
    );
    return { descriptions, suppliers, customers };
  }
}
