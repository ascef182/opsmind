import { FinanceReportsService } from './finance-reports.service';
import type { PrismaService } from '../../infrastructure/database/prisma.service';

const ORG = 'org-1';

function entryRow(over: Record<string, unknown> = {}) {
  return {
    id: 'e1',
    direction: 'EXPENSE',
    category: 'TOOLS',
    customerId: null,
    contractId: null,
    amountCents: 1000,
    feesCents: 0,
    paidCents: 1000,
    status: 'PAID',
    issueDate: new Date('2026-11-05'),
    dueDate: new Date('2026-11-05'),
    settledAt: new Date('2026-11-05'),
    ...over,
  };
}

function contractRow(over: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    customerId: 'cust-1',
    title: 'Contrato mensal',
    billing: 'MONTHLY',
    status: 'ACTIVE',
    valueCents: 500000,
    startDate: new Date('2026-01-01'),
    endDate: null,
    billingDay: 5,
    ...over,
  };
}

function paymentRow(over: Record<string, unknown> = {}) {
  return {
    entryId: 'e1',
    amountCents: 1000,
    paidAt: new Date('2026-11-05'),
    entry: { direction: 'EXPENSE', category: 'TOOLS', customerId: null, contractId: null },
    ...over,
  };
}

// Dataset fake: as duas chamadas de `loadDataset` (uma por escopo) devolvem
// linhas diferentes dependendo do `scope` pedido no `where` — é exatamente o
// que o service real faz contra o Postgres, só que aqui em memória.
function setup() {
  const prisma = {
    financialEntry: {
      findMany: jest.fn((args: { where: { scope?: string; id?: unknown } }) => {
        if (args.where.id) return Promise.resolve([]); // counterpartyNames (sem lançamentos abertos aqui)
        const business = [entryRow({ id: 'b1' })];
        const personal = [entryRow({ id: 'p1' })];
        return Promise.resolve(args.where.scope === 'PERSONAL' ? personal : business);
      }),
    },
    financialPayment: {
      findMany: jest.fn((args: { where: { entry?: { scope?: string } } }) => {
        const business = [paymentRow({ entryId: 'b1', amountCents: 2000 })];
        const personal = [paymentRow({ entryId: 'p1', amountCents: 500 })];
        return Promise.resolve(args.where.entry?.scope === 'PERSONAL' ? personal : business);
      }),
    },
    contract: { findMany: jest.fn().mockResolvedValue([contractRow()]) },
    deal: { findMany: jest.fn().mockResolvedValue([]) },
    customer: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const service = new FinanceReportsService(prisma as unknown as PrismaService);
  return { service, prisma };
}

describe('FinanceReportsService.overview', () => {
  it('KPIs principais (summary) contam só BUSINESS; o pessoal some separado em `personal`', async () => {
    const { service } = setup();
    const result = await service.overview(ORG, { month: '2026-11' } as never);

    expect(result.summary.expensesPaidCents).toBe(2000);
    expect(result.personal.summary.expensesPaidCents).toBe(500);
  });

  it('pede os lançamentos de cada escopo com o filtro correto no Prisma', async () => {
    const { service, prisma } = setup();
    await service.overview(ORG, { month: '2026-11' } as never);

    const entryScopes = prisma.financialEntry.findMany.mock.calls
      .map(([args]: [{ where: { scope?: string; id?: unknown } }]) => args.where.scope)
      .filter((s: string | undefined): s is string => s !== undefined);
    expect(entryScopes.sort()).toEqual(['BUSINESS', 'PERSONAL']);

    const paymentScopes = prisma.financialPayment.findMany.mock.calls.map(
      ([args]: [{ where: { entry?: { scope?: string } } }]) => args.where.entry?.scope,
    );
    expect(paymentScopes.sort()).toEqual(['BUSINESS', 'PERSONAL']);
  });

  it('contrato (sempre da empresa) nunca aparece como receita contratada no bloco pessoal', async () => {
    const { service, prisma } = setup();
    const result = await service.overview(ORG, { month: '2026-11' } as never);

    expect(prisma.contract.findMany).toHaveBeenCalledTimes(1); // um fetch só, reaproveitado — contrato não tem escopo
    expect(result.summary.contractedCents).toBeGreaterThan(0); // o lado business continua vendo o contrato
    expect(result.personal.summary.contractedCents).toBe(0);
  });
});

describe('FinanceReportsService.annual', () => {
  it('pede BUSINESS para o dataset principal e inclui o bloco `personal`', async () => {
    const { service, prisma } = setup();
    const result = await service.annual(ORG, 2026);

    const entryScopes = prisma.financialEntry.findMany.mock.calls
      .map(([args]: [{ where: { scope?: string; id?: unknown } }]) => args.where.scope)
      .filter((s: string | undefined): s is string => s !== undefined);
    expect(entryScopes.sort()).toEqual(['BUSINESS', 'PERSONAL']);
    expect(result.personal.summary.expensesPaidCents).toBe(500);
    expect(result.personal.summary.contractedCents).toBe(0);
  });
});

describe('FinanceReportsService.profitability', () => {
  it('carrega só o dataset BUSINESS — lançamento pessoal nunca entra na rentabilidade', async () => {
    const { service, prisma } = setup();
    await service.profitability(ORG, { by: 'customer' } as never);

    const entryScopes = prisma.financialEntry.findMany.mock.calls.map(
      ([args]: [{ where: { scope?: string; id?: unknown } }]) => args.where.scope,
    );
    expect(entryScopes.every((s: string | undefined) => s === 'BUSINESS')).toBe(true);
  });
});
