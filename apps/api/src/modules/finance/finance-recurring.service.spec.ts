import { BadRequestException } from '@nestjs/common';
import { FinanceRecurringService } from './finance-recurring.service';
import type { PrismaService } from '../../infrastructure/database/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { FinanceEntriesService } from './finance-entries.service';

const ORG = 'org-1';
const ACTOR = { type: 'USER', id: 'user-1' } as never;

function templateRow(over: Record<string, unknown> = {}) {
  return {
    id: 't1',
    organizationId: ORG,
    direction: 'EXPENSE',
    category: 'TOOLS',
    scope: 'BUSINESS',
    description: 'Assinatura',
    supplierName: null,
    amountCents: 2000,
    feesCents: 0,
    dayOfMonth: 5,
    startMonth: '2026-11',
    endMonth: null,
    active: true,
    customerId: null,
    contractId: null,
    ...over,
  };
}

function setup() {
  const prisma = {
    recurringEntry: {
      create: jest.fn().mockImplementation((args: { data: Record<string, unknown> }) =>
        Promise.resolve(templateRow(args.data)),
      ),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(templateRow()),
      update: jest.fn().mockImplementation((args: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...templateRow(), ...args.data }),
      ),
    },
    financialEntry: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const entriesService = { resolveLinks: jest.fn().mockResolvedValue({ customerId: null, contractId: null }) };
  const service = new FinanceRecurringService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    entriesService as unknown as FinanceEntriesService,
  );
  return { service, prisma, audit, entriesService };
}

describe('FinanceRecurringService.create', () => {
  const base = {
    direction: 'EXPENSE' as const,
    category: 'TOOLS' as const,
    description: 'Assinatura',
    amountCents: 2000,
    dayOfMonth: 5,
  };

  it('sem scope informado, grava BUSINESS', async () => {
    const { service, prisma } = setup();
    await service.create(ORG, base, ACTOR);
    expect(prisma.recurringEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ scope: 'BUSINESS' }) }),
    );
  });

  it('com scope PERSONAL informado, grava PERSONAL e propaga para os lançamentos gerados', async () => {
    const { service, prisma } = setup();
    await service.create(ORG, { ...base, scope: 'PERSONAL' }, ACTOR);
    expect(prisma.recurringEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ scope: 'PERSONAL' }) }),
    );
    expect(prisma.financialEntry.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.arrayContaining([expect.objectContaining({ scope: 'PERSONAL' })]) }),
    );
  });

  it('molde PESSOAL vinculado a contrato é rejeitado (contrato é sempre da empresa)', async () => {
    const { service, prisma } = setup();
    await expect(service.create(ORG, { ...base, scope: 'PERSONAL', contractId: 'contract-1' }, ACTOR)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.recurringEntry.create).not.toHaveBeenCalled();
  });

  it('moeda estrangeira sem o valor nominal (ou vice-versa) é rejeitada', async () => {
    const { service, prisma } = setup();
    await expect(service.create(ORG, { ...base, foreignCurrency: 'USD' }, ACTOR)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.create(ORG, { ...base, foreignAmountCents: 500 }, ACTOR)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.recurringEntry.create).not.toHaveBeenCalled();
  });

  it('com moeda estrangeira, grava no molde e propaga (sem cotação/IOF) para os lançamentos gerados', async () => {
    const { service, prisma } = setup();
    await service.create(ORG, { ...base, foreignCurrency: 'USD', foreignAmountCents: 500 }, ACTOR);
    expect(prisma.recurringEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ foreignCurrency: 'USD', foreignAmountCents: 500 }) }),
    );
    expect(prisma.financialEntry.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([expect.objectContaining({ foreignCurrency: 'USD', foreignAmountCents: 500 })]),
      }),
    );
  });
});

describe('FinanceRecurringService.update', () => {
  function setupWithCurrent(current: Record<string, unknown>) {
    const base = setup();
    base.prisma.recurringEntry.findFirst.mockResolvedValue(current);
    base.prisma.recurringEntry.update.mockImplementation((args: { data: Record<string, unknown> }) =>
      Promise.resolve({ ...current, ...args.data }),
    );
    return base;
  }

  it('câmbio não informado mantém o que já estava gravado no molde', async () => {
    const { service, prisma } = setupWithCurrent(templateRow({ foreignCurrency: 'USD', foreignAmountCents: 500 }));
    await service.update(ORG, 't1', { description: 'Railway' }, ACTOR);
    expect(prisma.recurringEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ foreignCurrency: 'USD', foreignAmountCents: 500 }) }),
    );
  });

  it('adicionar moeda estrangeira sem o valor nominal é rejeitado', async () => {
    const { service, prisma } = setupWithCurrent(templateRow());
    await expect(service.update(ORG, 't1', { foreignCurrency: 'USD' }, ACTOR)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.recurringEntry.update).not.toHaveBeenCalled();
  });

  it('retroceder a USD/valor nominal pode ser aplicado junto (não retroage nos lançamentos já gerados)', async () => {
    const { service, prisma } = setupWithCurrent(templateRow());
    await service.update(ORG, 't1', { foreignCurrency: 'USD', foreignAmountCents: 2000 }, ACTOR);
    expect(prisma.recurringEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ foreignCurrency: 'USD', foreignAmountCents: 2000 }) }),
    );
    expect(prisma.financialEntry.createMany).not.toHaveBeenCalled();
  });
});
