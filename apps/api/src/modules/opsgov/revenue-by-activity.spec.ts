import { monthlyRevenue, revenueByActivity, type ActivityVersion } from './revenue-by-activity';
import type { BusinessIncomeDataset } from '../finance/finance-reports.service';

function entry(id: string, companyActivityId: string | null, issueDate: string, amountCents: number, status = 'PAID') {
  return {
    id,
    direction: 'INCOME' as const,
    category: 'PROJECT' as const,
    customerId: null,
    contractId: null,
    amountCents,
    feesCents: 0,
    paidCents: status === 'PAID' ? amountCents : 0,
    status: status as never,
    issueDate,
    dueDate: issueDate,
    settledAt: status === 'PAID' ? issueDate : null,
    companyActivityId,
  };
}

const versions: ActivityVersion[] = [
  { id: 'dev-v1', cnae: '6201-5/01', description: 'Software sob encomenda', revenueGroup: 'OUTROS', validFrom: '2026-01-01' },
  { id: 'dev-v2', cnae: '6201-5/01', description: 'Software sob encomenda', revenueGroup: 'TECNOLOGIA', validFrom: '2026-02-01' },
  { id: 'trad', cnae: '8219-9/99', description: 'Tradução', revenueGroup: 'TRADUCAO_LEGENDAGEM', validFrom: '2026-01-01' },
];

const data: BusinessIncomeDataset = {
  entries: [
    entry('e1', 'dev-v1', '2026-01-10', 100_000),
    entry('e2', 'dev-v2', '2026-02-10', 300_000),
    entry('e3', 'trad', '2026-02-15', 50_000),
    entry('e4', null, '2026-02-20', 7_000),
    entry('e5', 'trad', '2026-02-25', 99_000, 'PLANNED'),
    entry('e6', 'trad', '2026-02-26', 88_000, 'CANCELLED'),
  ],
  payments: [
    { entryId: 'e2', amountCents: 300_000, paidAt: '2026-03-05', direction: 'INCOME', category: 'PROJECT', customerId: null, contractId: null, companyActivityId: 'dev-v2' },
  ],
};

describe('revenueByActivity', () => {
  it('competência: soma por CNAE juntando versões, ignorando previsto e cancelado', () => {
    const report = revenueByActivity(data, versions, '2026-01', '2026-03', 'COMPETENCIA');
    expect(report.months).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(report.rows).toEqual([
      expect.objectContaining({ cnae: '6201-5/01', revenueGroup: 'TECNOLOGIA', monthsCents: [100_000, 300_000, 0], totalCents: 400_000 }),
      expect.objectContaining({ cnae: '8219-9/99', monthsCents: [0, 50_000, 0], totalCents: 50_000 }),
    ]);
    expect(report.unclassified).toEqual({ monthsCents: [0, 7_000, 0], totalCents: 7_000 });
    expect(report.totals.totalCents).toBe(457_000);
  });

  it('grupo de receita segue a versão vigente na emissão, não a atual', () => {
    const report = revenueByActivity(data, versions, '2026-01', '2026-03', 'COMPETENCIA');
    const byGroup = Object.fromEntries(report.groups.map((g) => [g.revenueGroup, g.totalCents]));
    expect(byGroup).toEqual({ TECNOLOGIA: 300_000, TRADUCAO_LEGENDAGEM: 50_000, OUTROS: 100_000 });
  });

  it('caixa: usa a data do pagamento', () => {
    const report = revenueByActivity(data, versions, '2026-01', '2026-03', 'CAIXA');
    expect(report.rows).toEqual([expect.objectContaining({ cnae: '6201-5/01', monthsCents: [0, 0, 300_000] })]);
    expect(report.totals.totalCents).toBe(300_000);
  });
});

describe('monthlyRevenue', () => {
  it('inclui receita não classificada', () => {
    expect(monthlyRevenue(data, '2026-01', '2026-02', 'COMPETENCIA')).toEqual({ '2026-01': 100_000, '2026-02': 357_000 });
  });
});
