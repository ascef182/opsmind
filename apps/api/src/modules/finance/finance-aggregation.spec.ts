import type { ContractTerms } from '@opsmind/shared-types';
import {
  expectedFlow,
  monthlySeries,
  profitability,
  quarterlySeries,
  summarizeOpenBalances,
  summarizePeriod,
  sumPoints,
  totalsByCategory,
  type ContractRow,
  type EntryRow,
  type PaymentRow,
} from './finance-aggregation';

const entry = (over: Partial<EntryRow>): EntryRow => ({
  id: 'e',
  direction: 'INCOME',
  category: 'PROJECT',
  customerId: 'c1',
  contractId: null,
  amountCents: 100000,
  feesCents: 0,
  paidCents: 0,
  status: 'PENDING',
  issueDate: '2026-11-01',
  dueDate: '2026-11-10',
  settledAt: null,
  ...over,
});

const payment = (over: Partial<PaymentRow>): PaymentRow => ({
  entryId: 'e',
  amountCents: 100000,
  paidAt: '2026-11-10',
  direction: 'INCOME',
  category: 'PROJECT',
  customerId: 'c1',
  contractId: null,
  ...over,
});

const oneTime = (over: Partial<ContractRow> = {}): ContractRow => ({
  id: 'k1',
  customerId: 'c1',
  title: 'Projeto',
  billing: 'ONE_TIME',
  status: 'ACTIVE',
  valueCents: 600000,
  startDate: '2026-11-03',
  endDate: null,
  billingDay: null,
  ...over,
});

describe('summarizePeriod — contratado, faturado e recebido nunca se misturam', () => {
  const entries: EntryRow[] = [
    // faturado e totalmente recebido (taxa de 3.000 reconhecida na quitação)
    entry({ id: 'a', amountCents: 300000, feesCents: 3000, paidCents: 300000, status: 'PAID', settledAt: '2026-11-10' }),
    // faturado, nada recebido
    entry({ id: 'b', amountCents: 579000, status: 'PENDING' }),
    // previsto: ainda NÃO é faturado
    entry({ id: 'c', amountCents: 200000, status: 'PLANNED', dueDate: '2026-11-20' }),
    // cancelado: não conta em nada
    entry({ id: 'd', amountCents: 999900, status: 'CANCELLED' }),
    // despesa paga
    entry({ id: 'x', direction: 'EXPENSE', category: 'INFRASTRUCTURE', amountCents: 50000, paidCents: 50000, status: 'PAID', settledAt: '2026-11-05' }),
    // despesa prevista
    entry({ id: 'y', direction: 'EXPENSE', category: 'AI', amountCents: 30000, status: 'PLANNED', dueDate: '2026-11-25' }),
  ];
  const payments: PaymentRow[] = [
    payment({ entryId: 'a', amountCents: 300000 }),
    payment({ entryId: 'x', amountCents: 50000, direction: 'EXPENSE', category: 'INFRASTRUCTURE', paidAt: '2026-11-05', customerId: null }),
  ];

  const result = summarizePeriod({ entries, payments, contracts: [oneTime()] }, '2026-11-01', '2026-11-30');

  it('contratado vem do contrato, não dos lançamentos', () => {
    expect(result.contractedCents).toBe(600000);
  });
  it('faturado ignora previsto e cancelado', () => {
    expect(result.invoicedCents).toBe(300000 + 579000);
  });
  it('previsto fica à parte', () => {
    expect(result.plannedIncomeCents).toBe(200000);
    expect(result.expensesPlannedCents).toBe(30000);
  });
  it('recebido é só o que tem pagamento', () => {
    expect(result.receivedCents).toBe(300000);
  });
  it('resultado realizado = recebido - taxas - despesas pagas', () => {
    expect(result.feesCents).toBe(3000);
    expect(result.expensesPaidCents).toBe(50000);
    expect(result.resultCents).toBe(300000 - 3000 - 50000);
  });
  it('pagamento fora do período não entra', () => {
    const r = summarizePeriod({ entries, payments, contracts: [] }, '2026-12-01', '2026-12-31');
    expect(r.receivedCents).toBe(0);
    expect(r.resultCents).toBe(0);
  });
});

describe('summarizeOpenBalances', () => {
  it('separa a receber / a pagar e destaca vencidos pelo saldo, não pelo valor cheio', () => {
    const today = '2026-11-06';
    const balances = summarizeOpenBalances(
      [
        entry({ id: '1', amountCents: 579000, dueDate: '2026-10-30' }), // vencido
        entry({ id: '2', amountCents: 100000, paidCents: 40000, status: 'PARTIAL', dueDate: '2026-10-01' }), // vencido, saldo 60000
        entry({ id: '3', amountCents: 70000, dueDate: '2026-12-01' }), // a vencer
        entry({ id: '4', amountCents: 10000, status: 'PLANNED', dueDate: '2026-01-01' }), // previsto não é a receber
        entry({ id: '5', amountCents: 10000, status: 'PAID', paidCents: 10000, settledAt: '2026-10-01' }),
        entry({ id: '6', direction: 'EXPENSE', category: 'TOOLS', amountCents: 25000, dueDate: '2026-11-01' }),
      ],
      today,
    );
    expect(balances.receivableOpenCents).toBe(579000 + 60000 + 70000);
    expect(balances.receivableOverdueCents).toBe(579000 + 60000);
    expect(balances.receivableOverdueCount).toBe(2);
    expect(balances.payableOpenCents).toBe(25000);
    expect(balances.payableOverdueCount).toBe(1);
  });
});

describe('totalsByCategory', () => {
  it('soma por categoria e ordena do maior para o menor', () => {
    const rows = totalsByCategory(
      [
        payment({ category: 'INFRASTRUCTURE', direction: 'EXPENSE', amountCents: 100 }),
        payment({ category: 'AI', direction: 'EXPENSE', amountCents: 500 }),
        payment({ category: 'AI', direction: 'EXPENSE', amountCents: 200 }),
        payment({ category: 'PROJECT', direction: 'INCOME', amountCents: 9999 }),
      ],
      'EXPENSE',
      '2026-11-01',
      '2026-11-30',
    );
    expect(rows).toEqual([
      { category: 'AI', cents: 700 },
      { category: 'INFRASTRUCTURE', cents: 100 },
    ]);
  });
});

describe('séries mensal e trimestral', () => {
  const entries = [
    entry({ id: 'j', amountCents: 100, paidCents: 100, status: 'PAID', issueDate: '2026-01-05', settledAt: '2026-01-20' }),
    entry({ id: 'f', amountCents: 200, paidCents: 200, status: 'PAID', issueDate: '2026-04-05', settledAt: '2026-04-20' }),
  ];
  const payments = [
    payment({ entryId: 'j', amountCents: 100, paidAt: '2026-01-20' }),
    payment({ entryId: 'f', amountCents: 200, paidAt: '2026-04-20' }),
    payment({ entryId: 'z', amountCents: 40, paidAt: '2026-05-02', direction: 'EXPENSE', category: 'TOOLS' }),
  ];
  const months = monthlySeries({ entries, payments, contracts: [] }, '2026-01', '2026-12');

  it('gera 12 meses, inclusive os vazios', () => {
    expect(months).toHaveLength(12);
    expect(months[1]!.receivedCents).toBe(0);
  });
  it('a soma dos meses fecha com o total do ano', () => {
    const year = summarizePeriod({ entries, payments, contracts: [] }, '2026-01-01', '2026-12-31');
    const total = sumPoints(months);
    expect(total.receivedCents).toBe(year.receivedCents);
    expect(total.resultCents).toBe(year.resultCents);
    expect(total.resultCents).toBe(300 - 40);
  });
  it('trimestres agregam três meses cada', () => {
    const q = quarterlySeries(months);
    expect(q.map((x) => x.quarter)).toEqual([1, 2, 3, 4]);
    expect(q[0]!.receivedCents).toBe(100);
    expect(q[1]!.receivedCents).toBe(200);
    expect(q[1]!.expensesPaidCents).toBe(40);
  });
  it('série parcial só devolve os trimestres cobertos', () => {
    const partial = monthlySeries({ entries, payments, contracts: [] }, '2026-01', '2026-02');
    expect(quarterlySeries(partial).map((x) => x.quarter)).toEqual([1]);
  });
});

describe('profitability', () => {
  const contract: ContractTerms & { id: string; customerId: string; title: string } = oneTime({ valueCents: 600000 });
  const entries: EntryRow[] = [
    entry({ id: 'r1', customerId: 'c1', contractId: 'k1', amountCents: 300000, feesCents: 1000, paidCents: 300000, status: 'PAID', settledAt: '2026-11-10' }),
    entry({ id: 'r2', customerId: 'c1', contractId: 'k1', amountCents: 300000, status: 'PENDING' }),
    entry({ id: 'r3', customerId: 'c2', contractId: null, amountCents: 579000, status: 'PENDING' }),
  ];
  const payments: PaymentRow[] = [
    payment({ entryId: 'r1', amountCents: 300000, customerId: 'c1', contractId: 'k1' }),
    // custo vinculado ao cliente c1 / contrato k1
    payment({ entryId: 'x1', amountCents: 50000, direction: 'EXPENSE', category: 'APIS', customerId: 'c1', contractId: 'k1' }),
    // custo geral (VPS compartilhada), sem vínculo
    payment({ entryId: 'x2', amountCents: 20000, direction: 'EXPENSE', category: 'INFRASTRUCTURE', customerId: null, contractId: null }),
  ];
  const input = { entries, payments, contracts: [contract] };

  it('por cliente: margem = recebido - taxas - custos vinculados; saldo em aberto à parte', () => {
    const rows = profitability(input, 'customer', '2026-11-01', '2026-11-30');
    const c1 = rows.find((r) => r.key === 'c1')!;
    expect(c1.contractedCents).toBe(600000);
    expect(c1.receivedCents).toBe(300000);
    expect(c1.feesCents).toBe(1000);
    expect(c1.costsCents).toBe(50000);
    expect(c1.marginCents).toBe(300000 - 1000 - 50000);
    expect(c1.marginPct).toBe(83); // 249000 / 300000 = 83,0%
    expect(c1.openCents).toBe(300000);

    const c2 = rows.find((r) => r.key === 'c2')!;
    expect(c2.receivedCents).toBe(0);
    expect(c2.openCents).toBe(579000);
    expect(c2.marginPct).toBeNull(); // sem recebimento, % não existe
  });

  it('custo geral aparece como linha sem vínculo, sempre por último, e o total fecha', () => {
    const rows = profitability(input, 'customer', '2026-11-01', '2026-11-30');
    expect(rows[rows.length - 1]!.key).toBeNull();
    expect(rows[rows.length - 1]!.costsCents).toBe(20000);
    const totalMargin = rows.reduce((s, r) => s + r.marginCents, 0);
    const period = summarizePeriod(input, '2026-11-01', '2026-11-30');
    expect(totalMargin).toBe(period.resultCents);
  });

  it('por contrato agrupa no contrato (projeto)', () => {
    const rows = profitability(input, 'contract', '2026-11-01', '2026-11-30');
    const k1 = rows.find((r) => r.key === 'k1')!;
    expect(k1.receivedCents).toBe(300000);
    expect(k1.costsCents).toBe(50000);
  });
});

describe('expectedFlow', () => {
  it('soma saldo em aberto + previstos com vencimento no período, separando entrada e saída', () => {
    const flow = expectedFlow(
      [
        entry({ id: '1', amountCents: 100000, paidCents: 40000, status: 'PARTIAL', dueDate: '2026-12-05' }),
        entry({ id: '2', amountCents: 50000, status: 'PLANNED', dueDate: '2026-12-20' }),
        entry({ id: '3', amountCents: 70000, status: 'PAID', paidCents: 70000, settledAt: '2026-12-01', dueDate: '2026-12-01' }),
        entry({ id: '4', amountCents: 90000, status: 'CANCELLED', dueDate: '2026-12-02' }),
        entry({ id: '5', direction: 'EXPENSE', category: 'TOOLS', amountCents: 25000, dueDate: '2026-12-10' }),
        entry({ id: '6', amountCents: 10000, dueDate: '2027-01-01' }),
      ],
      '2026-12-01',
      '2026-12-31',
    );
    expect(flow).toEqual({ expectedInCents: 60000 + 50000, expectedOutCents: 25000 });
  });
});
