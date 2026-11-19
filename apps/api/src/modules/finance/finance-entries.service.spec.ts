import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { todayInSaoPaulo } from '@opsmind/shared-types';
import { FinanceEntriesService } from './finance-entries.service';
import type { PrismaService } from '../../infrastructure/database/prisma.service';
import type { AuditService } from '../audit/audit.service';

const ORG = 'org-1';
const ACTOR = { type: 'USER', id: 'user-1' } as never;

function entryRow(over: Record<string, unknown> = {}) {
  return {
    id: 'e1',
    organizationId: ORG,
    direction: 'INCOME',
    category: 'PROJECT',
    scope: 'BUSINESS',
    description: 'Site',
    supplierName: null,
    customerId: null,
    contractId: null,
    recurringEntryId: null,
    referenceMonth: null,
    amountCents: 100000,
    feesCents: 0,
    paidCents: 0,
    status: 'PENDING',
    issueDate: new Date('2026-11-01'),
    dueDate: new Date('2026-11-10'),
    settledAt: null,
    cancelledAt: null,
    cancelReason: null,
    notes: null,
    createdAt: new Date('2026-11-01T00:00:00Z'),
    updatedAt: new Date('2026-11-01T00:00:00Z'),
    ...over,
  };
}

function setup(current = entryRow()) {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    financialEntry: {
      findFirst: jest.fn().mockResolvedValue(current),
      findUniqueOrThrow: jest.fn().mockResolvedValue(current),
      update: jest.fn().mockResolvedValue(current),
    },
    financialPayment: {
      create: jest.fn().mockResolvedValue({}),
      findFirst: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      aggregate: jest.fn().mockResolvedValue({ _sum: { amountCents: 0 }, _max: { paidAt: null } }),
    },
  };
  const prisma = {
    financialEntry: {
      findFirst: jest.fn().mockResolvedValue(current),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue(current),
    },
    contract: { findFirst: jest.fn() },
    customer: { findFirst: jest.fn() },
    runInTransaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const service = new FinanceEntriesService(prisma as unknown as PrismaService, audit as unknown as AuditService);
  return { service, prisma, tx, audit };
}

describe('FinanceEntriesService.registerPayment', () => {
  it('quita parcialmente: grava o pagamento e recalcula o estado a partir dos pagamentos', async () => {
    const { service, tx } = setup();
    tx.financialPayment.aggregate.mockResolvedValue({ _sum: { amountCents: 40000 }, _max: { paidAt: new Date('2026-11-05') } });
    await service.registerPayment(ORG, 'e1', { amountCents: 40000, paidAt: '2026-11-05' }, ACTOR);

    expect(tx.$queryRaw).toHaveBeenCalled(); // lock FOR UPDATE antes de ler
    expect(tx.financialPayment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ organizationId: ORG, entryId: 'e1', amountCents: 40000 }) }),
    );
    expect(tx.financialEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { paidCents: 40000, status: 'PARTIAL', settledAt: null } }),
    );
  });

  it('quitação total marca PAID com settledAt = data do último pagamento', async () => {
    const { service, tx } = setup();
    const last = new Date('2026-11-06');
    tx.financialPayment.aggregate.mockResolvedValue({ _sum: { amountCents: 100000 }, _max: { paidAt: last } });
    await service.registerPayment(ORG, 'e1', { amountCents: 100000, paidAt: '2026-11-06' }, ACTOR);
    expect(tx.financialEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { paidCents: 100000, status: 'PAID', settledAt: last } }),
    );
  });

  it('rejeita valor acima do saldo em aberto', async () => {
    const { service, tx } = setup(entryRow({ paidCents: 90000, status: 'PARTIAL' }));
    await expect(service.registerPayment(ORG, 'e1', { amountCents: 20000 }, ACTOR)).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.financialPayment.create).not.toHaveBeenCalled();
  });

  it('rejeita data no futuro sem tocar no banco', async () => {
    const { service, prisma } = setup();
    await expect(service.registerPayment(ORG, 'e1', { amountCents: 100, paidAt: '2999-01-01' }, ACTOR)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.runInTransaction).not.toHaveBeenCalled();
  });

  it('rejeita pagamento em lançamento cancelado', async () => {
    const { service } = setup(entryRow({ status: 'CANCELLED' }));
    await expect(service.registerPayment(ORG, 'e1', { amountCents: 100 }, ACTOR)).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejeita pagamento em lançamento apenas previsto (precisa faturar antes)', async () => {
    const { service, tx } = setup(entryRow({ status: 'PLANNED' }));
    await expect(service.registerPayment(ORG, 'e1', { amountCents: 100 }, ACTOR)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.financialPayment.create).not.toHaveBeenCalled();
  });

  it('lançamento de outra organização é 404 (consulta sempre filtra por organizationId)', async () => {
    const { service, prisma } = setup();
    prisma.financialEntry.findFirst.mockResolvedValue(null);
    await expect(service.registerPayment('outra-org', 'e1', { amountCents: 100 }, ACTOR)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.financialEntry.findFirst).toHaveBeenCalledWith({ where: { id: 'e1', organizationId: 'outra-org' } });
  });

  it('registra auditoria', async () => {
    const { service, audit } = setup();
    await service.registerPayment(ORG, 'e1', { amountCents: 100, paidAt: todayInSaoPaulo() }, ACTOR);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'finance.payment.registered', organizationId: ORG }));
  });
});

describe('FinanceEntriesService.reversePayment', () => {
  it('estorna sem apagar e recalcula (volta a PENDING quando nada resta pago)', async () => {
    const { service, tx } = setup(entryRow({ paidCents: 100000, status: 'PAID', settledAt: new Date('2026-11-06') }));
    tx.financialPayment.findFirst.mockResolvedValue({ id: 'p1', reversedAt: null });
    tx.financialPayment.aggregate.mockResolvedValue({ _sum: { amountCents: null }, _max: { paidAt: null } });
    await service.reversePayment(ORG, 'e1', 'p1', ' cobrança duplicada ', ACTOR);

    expect(tx.financialPayment.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { reversedAt: expect.any(Date), reverseReason: 'cobrança duplicada' },
    });
    expect(tx.financialEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { paidCents: 0, status: 'PENDING', settledAt: null } }),
    );
  });

  it('não estorna duas vezes', async () => {
    const { service, tx } = setup();
    tx.financialPayment.findFirst.mockResolvedValue({ id: 'p1', reversedAt: new Date() });
    await expect(service.reversePayment(ORG, 'e1', 'p1', 'x', ACTOR)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.financialPayment.update).not.toHaveBeenCalled();
  });

  it('pagamento inexistente é 404', async () => {
    const { service, tx } = setup();
    tx.financialPayment.findFirst.mockResolvedValue(null);
    await expect(service.reversePayment(ORG, 'e1', 'nope', 'x', ACTOR)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('FinanceEntriesService.create', () => {
  const base = {
    direction: 'EXPENSE' as const,
    category: 'INFRASTRUCTURE' as const,
    description: 'VPS',
    amountCents: 5000,
    dueDate: '2026-11-10',
  };

  it('categoria incompatível com o tipo é rejeitada', async () => {
    const { service, prisma } = setup();
    await expect(service.create(ORG, { ...base, category: 'PROJECT' }, ACTOR)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.financialEntry.create).not.toHaveBeenCalled();
  });

  it('taxa em despesa é rejeitada', async () => {
    const { service } = setup();
    await expect(service.create(ORG, { ...base, feesCents: 100 }, ACTOR)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('taxa maior que o valor é rejeitada', async () => {
    const { service } = setup();
    await expect(
      service.create(ORG, { direction: 'INCOME', category: 'PROJECT', description: 'x', amountCents: 100, feesCents: 200, dueDate: '2026-11-10' }, ACTOR),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('cria com a organização do contexto e audita', async () => {
    const { service, prisma, audit } = setup();
    await service.create(ORG, base, ACTOR);
    expect(prisma.financialEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ organizationId: ORG, amountCents: 5000, direction: 'EXPENSE' }) }),
    );
    expect(audit.log).toHaveBeenCalled();
  });

  it('sem scope informado, grava BUSINESS (todo lançamento é da empresa por padrão)', async () => {
    const { service, prisma } = setup();
    await service.create(ORG, base, ACTOR);
    expect(prisma.financialEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ scope: 'BUSINESS' }) }),
    );
  });

  it('com scope PERSONAL informado, grava PERSONAL', async () => {
    const { service, prisma } = setup();
    await service.create(ORG, { ...base, scope: 'PERSONAL' }, ACTOR);
    expect(prisma.financialEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ scope: 'PERSONAL' }) }),
    );
  });

  it('lançamento PESSOAL vinculado a contrato é rejeitado (contrato é sempre da empresa)', async () => {
    const { service, prisma } = setup();
    await expect(service.create(ORG, { ...base, scope: 'PERSONAL', contractId: 'contract-1' }, ACTOR)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.financialEntry.create).not.toHaveBeenCalled();
  });

  it('moeda estrangeira sem o valor nominal (ou vice-versa) é rejeitada', async () => {
    const { service, prisma } = setup();
    await expect(service.create(ORG, { ...base, foreignCurrency: 'USD' }, ACTOR)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.create(ORG, { ...base, foreignAmountCents: 500 }, ACTOR)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.financialEntry.create).not.toHaveBeenCalled();
  });

  it('cotação/IOF sem moeda estrangeira é rejeitada', async () => {
    const { service } = setup();
    await expect(service.create(ORG, { ...base, exchangeRate: 5.5 }, ACTOR)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.create(ORG, { ...base, iofCents: 100 }, ACTOR)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('IOF maior que o valor do lançamento é rejeitado', async () => {
    const { service } = setup();
    await expect(
      service.create(ORG, { ...base, foreignCurrency: 'USD', foreignAmountCents: 500, iofCents: 999999 }, ACTOR),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('grava moeda estrangeira, valor nominal, cotação e IOF quando informados', async () => {
    const { service, prisma } = setup();
    await service.create(
      ORG,
      { ...base, foreignCurrency: 'USD', foreignAmountCents: 500, exchangeRate: 5.62, iofCents: 159 },
      ACTOR,
    );
    expect(prisma.financialEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ foreignCurrency: 'USD', foreignAmountCents: 500, exchangeRate: 5.62, iofCents: 159 }),
      }),
    );
  });
});

describe('FinanceEntriesService.update', () => {
  it('scope não informado mantém o escopo atual (null/undefined nunca quebram em 500)', async () => {
    const { service, tx } = setup(entryRow({ scope: 'PERSONAL' }));
    await service.update(ORG, 'e1', { scope: null as never }, ACTOR);
    expect(tx.financialEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ scope: 'PERSONAL' }) }),
    );
  });

  it('troca de escopo é aplicada quando informada', async () => {
    const { service, tx } = setup(entryRow({ scope: 'BUSINESS' }));
    await service.update(ORG, 'e1', { scope: 'PERSONAL' }, ACTOR);
    expect(tx.financialEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ scope: 'PERSONAL' }) }),
    );
  });

  it('virar PESSOAL ou mudar a emissão desfaz a classificação por atividade (OpsGov)', async () => {
    const personal = setup(entryRow({ scope: 'BUSINESS', companyActivityId: 'act-1' }));
    await personal.service.update(ORG, 'e1', { scope: 'PERSONAL' }, ACTOR);
    expect(personal.tx.financialEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ companyActivityId: null }) }),
    );

    const redated = setup(entryRow({ companyActivityId: 'act-1' }));
    await redated.service.update(ORG, 'e1', { issueDate: '2026-12-01' }, ACTOR);
    expect(redated.tx.financialEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ companyActivityId: null }) }),
    );

    const untouched = setup(entryRow({ companyActivityId: 'act-1' }));
    await untouched.service.update(ORG, 'e1', { description: 'Site novo', issueDate: '2026-11-01' }, ACTOR);
    expect(untouched.tx.financialEntry.update.mock.calls[0][0].data).not.toHaveProperty('companyActivityId');
  });

  it('virar PESSOAL sem soltar o contrato é rejeitado (contrato é sempre da empresa)', async () => {
    const { service, tx } = setup(entryRow({ scope: 'BUSINESS', contractId: 'contract-1' }));
    await expect(service.update(ORG, 'e1', { scope: 'PERSONAL' }, ACTOR)).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.financialEntry.update).not.toHaveBeenCalled();
  });

  it('câmbio não informado mantém o que já estava gravado', async () => {
    const { service, tx } = setup(entryRow({ foreignCurrency: 'USD', foreignAmountCents: 500, iofCents: 159 }));
    await service.update(ORG, 'e1', { description: 'Railway' }, ACTOR);
    expect(tx.financialEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ foreignCurrency: 'USD', foreignAmountCents: 500, iofCents: 159 }),
      }),
    );
  });

  it('reconciliação do mês: grava cotação e IOF sobre um lançamento já com valor nominal', async () => {
    const { service, tx } = setup(entryRow({ amountCents: 2500, foreignCurrency: 'USD', foreignAmountCents: 500 }));
    await service.update(ORG, 'e1', { amountCents: 2823, exchangeRate: 5.33, iofCents: 157 }, ACTOR);
    expect(tx.financialEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ amountCents: 2823, exchangeRate: 5.33, iofCents: 157 }),
      }),
    );
  });

  it('IOF maior que o novo valor é rejeitado', async () => {
    const { service, tx } = setup(entryRow({ amountCents: 2500, foreignCurrency: 'USD', foreignAmountCents: 500 }));
    await expect(service.update(ORG, 'e1', { amountCents: 100, iofCents: 200 }, ACTOR)).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.financialEntry.update).not.toHaveBeenCalled();
  });
});

describe('FinanceEntriesService.list', () => {
  it('sem filtro de scope, não restringe por scope', async () => {
    const { service, prisma } = setup();
    await service.list(ORG, { limit: 20, offset: 0 } as never);
    expect(prisma.financialEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.not.objectContaining({ scope: expect.anything() }) }),
    );
  });

  it('com filtro de scope, restringe a where.scope', async () => {
    const { service, prisma } = setup();
    await service.list(ORG, { scope: 'PERSONAL', limit: 20, offset: 0 } as never);
    expect(prisma.financialEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ scope: 'PERSONAL' }) }),
    );
  });

  it('sem sort informado, ordena por vencimento mais recente primeiro', async () => {
    const { service, prisma } = setup();
    await service.list(ORG, { limit: 20, offset: 0 } as never);
    expect(prisma.financialEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ dueDate: 'desc' }, { createdAt: 'desc' }] }),
    );
  });

  it('com sort=asc, ordena por vencimento mais antigo primeiro', async () => {
    const { service, prisma } = setup();
    await service.list(ORG, { sort: 'asc', limit: 20, offset: 0 } as never);
    expect(prisma.financialEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }] }),
    );
  });
});
