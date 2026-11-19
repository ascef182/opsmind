import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RevenueService } from './revenue.service';
import type { PrismaService } from '../../infrastructure/database/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { FinanceReportsService } from '../finance/finance-reports.service';

const ORG = 'org-1';
const ACTOR = { type: 'USER', id: 'user-1' } as never;
const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';

function entry(id: string, over: Record<string, unknown> = {}) {
  return { id, direction: 'INCOME', scope: 'BUSINESS', status: 'PAID', issueDate: new Date('2026-03-10'), ...over };
}

const versions = [
  { id: 'v1', validFrom: new Date('2024-03-01'), validTo: new Date('2027-01-01') },
  { id: 'v2', validFrom: new Date('2027-01-01'), validTo: null },
];

function setup(entries: unknown[] = [entry(A), entry(B)]) {
  const tx = {
    financialEntry: {
      findMany: jest.fn().mockResolvedValue(entries),
      updateMany: jest.fn().mockImplementation(({ where }) => Promise.resolve({ count: where.id.in.length })),
    },
    companyActivity: {
      findFirst: jest.fn().mockResolvedValue({ cnae: '8219-9/99' }),
      findMany: jest.fn().mockResolvedValue(versions),
    },
  };
  const prisma = {
    companyRegistrationPeriod: { findFirst: jest.fn().mockResolvedValue(null) },
    companyActivity: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
    runInTransaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const finance = { businessIncomeDataset: jest.fn().mockResolvedValue({ entries: [], payments: [] }) };
  const service = new RevenueService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    finance as unknown as FinanceReportsService,
  );
  return { service, prisma, tx, audit, finance };
}

describe('RevenueService.classify', () => {
  it('liga cada lançamento à versão do CNAE vigente na sua emissão', async () => {
    const { service, tx, audit } = setup([entry(A), entry(B, { issueDate: new Date('2027-02-01') })]);

    const result = await service.classify(ORG, { entryIds: [A, B], companyActivityId: 'v2' }, ACTOR);

    expect(result).toEqual({ classified: 2 });
    expect(tx.financialEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: [A, B] }, organizationId: ORG } }),
    );
    expect(tx.financialEntry.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [A] }, organizationId: ORG },
      data: { companyActivityId: 'v1' },
    });
    expect(tx.financialEntry.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [B] }, organizationId: ORG },
      data: { companyActivityId: 'v2' },
    });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'opsgov.revenue.classified' }));
  });

  it('recusa o lote inteiro se houver despesa, lançamento pessoal ou cancelado', async () => {
    for (const bad of [{ direction: 'EXPENSE' }, { scope: 'PERSONAL' }, { status: 'CANCELLED' }]) {
      const { service, tx } = setup([entry(A), entry(B, bad)]);
      await expect(service.classify(ORG, { entryIds: [A, B], companyActivityId: 'v1' }, ACTOR)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(tx.financialEntry.updateMany).not.toHaveBeenCalled();
    }
  });

  it('recusa quando o CNAE não estava vigente na emissão de algum lançamento', async () => {
    const { service, tx } = setup([entry(A, { issueDate: new Date('2023-01-01') })]);
    await expect(service.classify(ORG, { entryIds: [A], companyActivityId: 'v1' }, ACTOR)).rejects.toThrow(/não estava vigente/);
    expect(tx.financialEntry.updateMany).not.toHaveBeenCalled();
  });

  it('lançamento ou atividade de outra organização vira 404', async () => {
    const missingEntry = setup([entry(A)]);
    await expect(
      missingEntry.service.classify(ORG, { entryIds: [A, B], companyActivityId: 'v1' }, ACTOR),
    ).rejects.toBeInstanceOf(NotFoundException);

    const missingActivity = setup();
    missingActivity.tx.companyActivity.findFirst.mockResolvedValue(null);
    await expect(
      missingActivity.service.classify(ORG, { entryIds: [A, B], companyActivityId: 'other' }, ACTOR),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(missingActivity.tx.companyActivity.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'other', organizationId: ORG } }),
    );
  });

  it('companyActivityId null desfaz a classificação', async () => {
    const { service, tx } = setup();
    await service.classify(ORG, { entryIds: [A, B], companyActivityId: null }, ACTOR);
    expect(tx.financialEntry.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [A, B] }, organizationId: ORG },
      data: { companyActivityId: null },
    });
  });
});

describe('RevenueService.rbt12', () => {
  it('soma os 12 meses anteriores a partir do faturamento BUSINESS', async () => {
    const { service, finance, prisma } = setup();
    prisma.companyRegistrationPeriod.findFirst.mockResolvedValue({ validFrom: new Date('2024-03-01') });
    finance.businessIncomeDataset.mockResolvedValue({
      entries: [
        {
          id: 'e',
          direction: 'INCOME',
          category: 'PROJECT',
          customerId: null,
          contractId: null,
          amountCents: 2_000_000,
          feesCents: 0,
          paidCents: 2_000_000,
          status: 'PAID',
          issueDate: '2026-06-10',
          dueDate: '2026-06-10',
          settledAt: '2026-06-10',
          companyActivityId: null,
        },
      ],
      payments: [],
    });

    const result = await service.rbt12(ORG, { month: '2027-01' });

    expect(finance.businessIncomeDataset).toHaveBeenCalledWith(ORG, '2026-01-01', '2027-01-31');
    expect(result).toEqual(
      expect.objectContaining({ month: '2027-01', rbt12Cents: 2_000_000, method: 'TWELVE_MONTHS', activityStartMonth: '2024-03' }),
    );
  });
});
