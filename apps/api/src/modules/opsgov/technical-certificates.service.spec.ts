import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TechnicalCertificatesService } from './technical-certificates.service';
import type { PrismaService } from '../../infrastructure/database/prisma.service';
import type { AuditService } from '../audit/audit.service';

const ORG = 'org-1';
const ACTOR = { type: 'USER', id: 'user-1' } as never;

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'tc-1',
    organizationId: ORG,
    issuer: 'Universidade X',
    object: 'Legendagem de 40 vídeos',
    periodStart: new Date('2026-03-01T00:00:00Z'),
    periodEnd: null,
    valueCents: 1_200_000,
    companyActivityId: null,
    customerId: null,
    contractId: null,
    documentId: null,
    notes: null,
    createdAt: new Date('2026-11-19T10:00:00Z'),
    companyActivity: null,
    customer: null,
    ...over,
  };
}

function setup() {
  const prisma = {
    technicalCertificate: {
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve(row(data))),
      findFirst: jest.fn().mockResolvedValue(row()),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve(row(data))),
    },
    companyActivity: { findFirst: jest.fn().mockResolvedValue({ id: 'act-1' }) },
    customer: { findFirst: jest.fn().mockResolvedValue({ id: 'cus-1' }) },
    contract: { findFirst: jest.fn().mockResolvedValue({ customerId: 'cus-1' }) },
    document: { findFirst: jest.fn().mockResolvedValue({ id: 'doc-1' }) },
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const service = new TechnicalCertificatesService(prisma as unknown as PrismaService, audit as unknown as AuditService);
  return { service, prisma };
}

const BASE = { issuer: ' Universidade X ', object: 'Legendagem', periodStart: '2026-03-01' };

describe('TechnicalCertificatesService', () => {
  it('registra o atestado com datas e valor', async () => {
    const { service, prisma } = setup();
    const view = await service.create(ORG, { ...BASE, periodEnd: '2026-06-30', valueCents: 1_200_000 }, ACTOR);
    expect(prisma.technicalCertificate.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ organizationId: ORG, issuer: 'Universidade X' }) }),
    );
    expect(view).toEqual(expect.objectContaining({ periodStart: '2026-03-01', periodEnd: '2026-06-30' }));
  });

  it('recusa período invertido', async () => {
    const { service } = setup();
    await expect(service.create(ORG, { ...BASE, periodEnd: '2026-02-01' }, ACTOR)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('não vincula CNAE, cliente ou contrato de outra organização', async () => {
    const { service, prisma } = setup();
    prisma.companyActivity.findFirst.mockResolvedValueOnce(null);
    await expect(service.create(ORG, { ...BASE, companyActivityId: 'act-x' }, ACTOR)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.companyActivity.findFirst).toHaveBeenCalledWith({
      where: { id: 'act-x', organizationId: ORG },
      select: { id: true },
    });

    prisma.contract.findFirst.mockResolvedValueOnce(null);
    await expect(service.create(ORG, { ...BASE, contractId: 'ctr-x' }, ACTOR)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('contrato precisa ser do cliente informado', async () => {
    const { service, prisma } = setup();
    prisma.contract.findFirst.mockResolvedValueOnce({ customerId: 'outro' });
    await expect(
      service.create(ORG, { ...BASE, customerId: 'cus-1', contractId: 'ctr-1' }, ACTOR),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('edição só mexe em vínculo, comprovante e anotações', async () => {
    const { service, prisma } = setup();
    await service.update(ORG, 'tc-1', { companyActivityId: null, notes: 'ok' }, ACTOR);
    expect(prisma.technicalCertificate.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'tc-1' }, data: { companyActivityId: null, notes: 'ok' } }),
    );
  });
});
