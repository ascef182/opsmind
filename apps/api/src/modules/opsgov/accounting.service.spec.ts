import { NotFoundException } from '@nestjs/common';
import { DEFAULT_ACCOUNTING_DECISIONS } from '@opsmind/shared-types';
import { AccountingService } from './accounting.service';
import type { PrismaService } from '../../infrastructure/database/prisma.service';
import type { AuditService } from '../audit/audit.service';

const ORG = 'org-1';
const ACTOR = { type: 'USER', id: 'user-1' } as never;

function decision(over: Record<string, unknown> = {}) {
  return {
    id: 'd-1',
    organizationId: ORG,
    seedKey: 'regime',
    topic: 'Regime tributário',
    question: 'Simples ou Presumido?',
    answers: [],
    finalDecision: null,
    decidedAt: null,
    status: 'PENDENTE',
    actorType: 'USER',
    actorId: 'user-1',
    createdAt: new Date('2026-11-19T10:00:00Z'),
    updatedAt: new Date('2026-11-19T10:00:00Z'),
    ...over,
  };
}

function setup(current: Record<string, unknown> | null = decision()) {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    accountingDecision: {
      findFirst: jest.fn().mockResolvedValue(current),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...current, ...data, updatedAt: new Date() })),
    },
  };
  const prisma = {
    accountingDecision: { createMany: jest.fn().mockResolvedValue({ count: 13 }), findMany: jest.fn().mockResolvedValue([]) },
    accountingProposal: {
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'p-1', createdAt: new Date(), updatedAt: new Date(), ...data })),
      findFirst: jest.fn().mockResolvedValue(null),
      delete: jest.fn(),
    },
    user: { findUnique: jest.fn().mockResolvedValue({ name: 'Pam', email: 'pam@cazatech.test' }) },
    document: { findFirst: jest.fn().mockResolvedValue({ id: 'doc-1' }) },
    runInTransaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const service = new AccountingService(prisma as unknown as PrismaService, audit as unknown as AuditService);
  return { service, prisma, tx, audit };
}

describe('AccountingService propostas', () => {
  it('normaliza a lista do que está incluído (sem vazios nem repetidos)', async () => {
    const { service, prisma } = setup();
    await service.createProposal(
      ORG,
      { firm: ' Escritório X ', scenario: 'A_TRANSFORMAR', setupCents: 80_000, monthlyFeeCents: 45_000, includes: ['DAS', ' ', 'DAS', 'Folha'] },
      ACTOR,
    );
    expect(prisma.accountingProposal.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ organizationId: ORG, firm: 'Escritório X', annualCents: 0, includes: ['DAS', 'Folha'] }),
    });
  });

  it('não apaga proposta de outra organização', async () => {
    const { service, prisma } = setup();
    await expect(service.deleteProposal(ORG, 'p-x', ACTOR)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.accountingProposal.findFirst).toHaveBeenCalledWith({ where: { id: 'p-x', organizationId: ORG } });
    expect(prisma.accountingProposal.delete).not.toHaveBeenCalled();
  });
});

describe('AccountingService decisões', () => {
  it('lista as padrão na ordem da lista e depois as criadas à mão', async () => {
    const { service, prisma } = setup();
    prisma.accountingDecision.findMany.mockResolvedValue([
      decision({ id: 'manual', seedKey: null, topic: 'A primeira em ordem alfabética' }),
      decision({ id: 'sede', seedKey: 'endereco_sede' }),
      decision({ id: 'cnpj', seedKey: 'cnpj' }),
    ]);
    expect((await service.listDecisions(ORG)).map((d) => d.id)).toEqual(['cnpj', 'sede', 'manual']);
  });

  it('carrega as decisões padrão de forma idempotente (skipDuplicates por seedKey)', async () => {
    const { service, prisma } = setup();
    expect(await service.loadDefaultDecisions(ORG, ACTOR)).toEqual({ created: 13 });
    const call = prisma.accountingDecision.createMany.mock.calls[0][0];
    expect(call.skipDuplicates).toBe(true);
    expect(call.data).toHaveLength(DEFAULT_ACCOUNTING_DECISIONS.length);
    expect(call.data[0]).toEqual(expect.objectContaining({ organizationId: ORG, seedKey: 'cnpj' }));
  });

  it('primeira resposta acrescenta ao histórico e move para EM_ANALISE, sob lock', async () => {
    const { service, tx } = setup();
    const view = await service.addAnswer(ORG, 'd-1', { text: 'Simples compensa até 3,6 mi', author: 'Contador' }, ACTOR);

    expect(tx.$queryRaw).toHaveBeenCalled();
    const data = tx.accountingDecision.update.mock.calls[0][0].data;
    expect(data.status).toBe('EM_ANALISE');
    expect(data.answers).toEqual([expect.objectContaining({ text: 'Simples compensa até 3,6 mi', author: 'Contador', authorUserId: 'user-1' })]);
    expect(view.answers).toHaveLength(1);
  });

  it('sem autor informado, usa o nome de quem respondeu', async () => {
    const { service, tx } = setup(decision({ status: 'EM_ANALISE', answers: [{ text: 'a', author: 'X', authorUserId: null, at: '2026-11-19T10:00:00Z' }] }));
    await service.addAnswer(ORG, 'd-1', { text: 'b' }, ACTOR);
    const data = tx.accountingDecision.update.mock.calls[0][0].data;
    expect(data.answers.map((a: { author: string }) => a.author)).toEqual(['X', 'Pam']);
    expect(data).not.toHaveProperty('status');
  });

  it('trocar a decisão final guarda a anterior no histórico', async () => {
    const { service, tx } = setup(decision({ status: 'DECIDIDO', finalDecision: 'Simples', decidedAt: new Date() }));
    await service.decide(ORG, 'd-1', { finalDecision: 'Lucro Presumido' }, ACTOR);
    const data = tx.accountingDecision.update.mock.calls[0][0].data;
    expect(data).toEqual(expect.objectContaining({ finalDecision: 'Lucro Presumido', status: 'DECIDIDO' }));
    expect(data.answers).toEqual([expect.objectContaining({ text: 'Decisão anterior: Simples' })]);
  });

  it('reabrir limpa a decisão final mas registra o que era', async () => {
    const { service, tx } = setup(decision({ status: 'DECIDIDO', finalDecision: 'CNPJ novo', decidedAt: new Date() }));
    await service.setStatus(ORG, 'd-1', { status: 'EM_ANALISE' }, ACTOR);
    const data = tx.accountingDecision.update.mock.calls[0][0].data;
    expect(data).toEqual(expect.objectContaining({ status: 'EM_ANALISE', finalDecision: null, decidedAt: null }));
    expect(data.answers[0].text).toBe('Decisão reaberta. Decisão anterior: CNPJ novo');
  });

  it('decisão de outra organização vira 404', async () => {
    const { service, tx } = setup(null);
    await expect(service.decide(ORG, 'd-x', { finalDecision: 'x' }, ACTOR)).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.accountingDecision.findFirst).toHaveBeenCalledWith({ where: { id: 'd-x', organizationId: ORG } });
  });
});
