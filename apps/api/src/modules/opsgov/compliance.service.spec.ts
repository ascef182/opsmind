import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ComplianceService } from './compliance.service';
import type { PrismaService } from '../../infrastructure/database/prisma.service';
import type { AuditService } from '../audit/audit.service';

const ORG = 'org-1';
const ACTOR = { type: 'USER', id: 'user-1' } as never;

function obligation(over: Record<string, unknown> = {}) {
  return {
    id: 'ob-1',
    organizationId: ORG,
    type: 'DAS',
    title: 'DAS mensal',
    recurrence: 'MONTHLY',
    dueDay: 20,
    dueMonth: null,
    nextDueDate: new Date('2026-12-20'),
    status: 'PENDENTE',
    notes: null,
    actorType: 'USER',
    actorId: 'user-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

function certificate(id: string, type: string, validUntil: string) {
  return {
    id,
    organizationId: ORG,
    type,
    issuer: null,
    code: null,
    issuedOn: new Date('2026-06-01'),
    validUntil: new Date(validUntil),
    notes: null,
    documentId: null,
    actorType: 'USER',
    actorId: 'user-1',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function setup(current = obligation()) {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    complianceObligation: {
      findFirst: jest.fn().mockResolvedValue(current),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...current, ...data })),
    },
    complianceObligationCompletion: {
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'c-1', ...data })),
    },
  };
  const prisma = {
    complianceObligation: {
      findFirst: jest.fn().mockResolvedValue(current),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve(obligation({ id: 'new', ...data }))),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...current, ...data })),
    },
    certificate: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'cert-new', createdAt: new Date(), updatedAt: new Date(), ...data })),
    },
    document: { findFirst: jest.fn().mockResolvedValue({ id: 'doc-1' }) },
    runInTransaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const service = new ComplianceService(prisma as unknown as PrismaService, audit as unknown as AuditService);
  return { service, prisma, tx, audit };
}

describe('ComplianceService obrigações', () => {
  it('recorrente sem data inicial calcula o primeiro vencimento pela regra', async () => {
    const { service, prisma } = setup();
    await service.createObligation(ORG, { type: 'DAS', title: 'DAS', recurrence: 'MONTHLY', dueDay: 20 }, ACTOR);
    const data = prisma.complianceObligation.create.mock.calls[0][0].data;
    expect(data).toEqual(expect.objectContaining({ organizationId: ORG, recurrence: 'MONTHLY', dueDay: 20, dueMonth: null }));
    expect(data.nextDueDate.toISOString().slice(8, 10)).toBe('20');
  });

  it('valida a regra: recorrente sem dia, anual sem mês, única sem data', async () => {
    const { service } = setup();
    await expect(service.createObligation(ORG, { type: 'DAS', title: 'X', recurrence: 'MONTHLY' }, ACTOR)).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.createObligation(ORG, { type: 'DEFIS', title: 'X', recurrence: 'YEARLY', dueDay: 31 }, ACTOR),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.createObligation(ORG, { type: 'OUTRA', title: 'X', recurrence: 'ONCE' }, ACTOR)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('cumprir grava o histórico do vencimento e avança para o próximo, sob lock', async () => {
    const { service, tx, audit } = setup();
    const view = await service.completeObligation(ORG, 'ob-1', { completedOn: '2026-12-18' }, ACTOR);

    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.complianceObligationCompletion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ organizationId: ORG, obligationId: 'ob-1', dueDate: new Date('2026-12-20'), completedOn: new Date('2026-12-18') }),
    });
    expect(tx.complianceObligation.update).toHaveBeenCalledWith({ where: { id: 'ob-1' }, data: { nextDueDate: new Date('2027-01-20') } });
    expect(view).toEqual(expect.objectContaining({ nextDueDate: '2027-01-20', status: 'PENDENTE' }));
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'opsgov.obligation.completed' }));
  });

  it('obrigação única cumprida vira CUMPRIDA', async () => {
    const { service, tx } = setup(obligation({ recurrence: 'ONCE', dueDay: null }));
    await service.completeObligation(ORG, 'ob-1', {}, ACTOR);
    expect(tx.complianceObligation.update).toHaveBeenCalledWith({ where: { id: 'ob-1' }, data: { status: 'CUMPRIDA' } });
  });

  it('não cumpre obrigação de outra organização nem já encerrada', async () => {
    const other = setup();
    other.tx.complianceObligation.findFirst.mockResolvedValue(null);
    await expect(other.service.completeObligation(ORG, 'ob-x', {}, ACTOR)).rejects.toBeInstanceOf(NotFoundException);
    expect(other.tx.complianceObligation.findFirst).toHaveBeenCalledWith({ where: { id: 'ob-x', organizationId: ORG } });

    const done = setup(obligation({ status: 'DISPENSADA' }));
    await expect(done.service.completeObligation(ORG, 'ob-1', {}, ACTOR)).rejects.toBeInstanceOf(ConflictException);
    expect(done.tx.complianceObligationCompletion.create).not.toHaveBeenCalled();
  });

  it('dispensar guarda o motivo nas notas', async () => {
    const { service, prisma } = setup();
    await service.dismissObligation(ORG, 'ob-1', { reason: 'Saiu do SIMEI' }, ACTOR);
    expect(prisma.complianceObligation.update).toHaveBeenCalledWith({
      where: { id: 'ob-1' },
      data: { status: 'DISPENSADA', notes: 'Dispensada: Saiu do SIMEI' },
    });
  });
});

describe('ComplianceService certidões', () => {
  it('status é calculado e só a mais recente de cada tipo é a vigente', async () => {
    const { service, prisma } = setup();
    prisma.certificate.findMany.mockResolvedValue([
      certificate('fed-new', 'CND_FEDERAL', '2027-03-01'),
      certificate('fed-old', 'CND_FEDERAL', '2026-11-01'),
      certificate('fgts', 'FGTS_CRF', '2026-11-30'),
    ]);

    const views = await service.listCertificates(ORG, '2026-11-19');

    expect(views.map((v) => [v.id, v.status, v.isCurrent])).toEqual([
      ['fed-new', 'VALIDA', true],
      ['fed-old', 'VENCIDA', false],
      ['fgts', 'VENCENDO', true],
    ]);
  });

  it('recusa validade anterior à emissão', async () => {
    const { service, prisma } = setup();
    await expect(
      service.createCertificate(ORG, { type: 'CND_FEDERAL', issuedOn: '2026-11-10', validUntil: '2026-11-09' }, ACTOR),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.certificate.create).not.toHaveBeenCalled();
  });

  it('comprovante de outra organização é recusado', async () => {
    const { service, prisma } = setup();
    prisma.document.findFirst.mockResolvedValue(null);
    await expect(
      service.createCertificate(
        ORG,
        { type: 'CND_FEDERAL', issuedOn: '2026-11-10', validUntil: '2027-05-09', documentId: 'doc-x' },
        ACTOR,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
