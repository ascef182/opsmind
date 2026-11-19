import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ProcurementService } from './procurement.service';
import type { PrismaService } from '../../infrastructure/database/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { CustomersService } from '../customers/customers.service';
import type { FinanceContractsService } from '../finance/finance-contracts.service';
import type { CompanyProfileService } from './company-profile.service';
import type { ComplianceService } from './compliance.service';

const ORG = 'org-1';
const ACTOR = { type: 'USER', id: 'user-1' } as never;

function opportunity(over: Record<string, unknown> = {}) {
  return {
    id: 'op-1',
    organizationId: ORG,
    agency: 'Prefeitura de Exemplo',
    agencyCode: '123456',
    processNumber: '90001/2026',
    modality: 'PREGAO_ELETRONICO',
    object: 'Tradução de documentos',
    editalUrl: null,
    sessionDate: new Date('2026-12-10T00:00:00Z'),
    proposalDeadline: null,
    estimatedValueCents: 5_000_000,
    editalDocumentId: null,
    status: 'RADAR',
    statusChangedAt: new Date('2026-11-19T10:00:00Z'),
    notes: null,
    customerId: null,
    contractId: null,
    convertedAt: null,
    actorType: 'USER',
    actorId: 'user-1',
    createdAt: new Date('2026-11-19T10:00:00Z'),
    updatedAt: new Date('2026-11-19T10:00:00Z'),
    ...over,
  };
}

function setup(current: Record<string, unknown> | null = opportunity()) {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    procurementOpportunity: {
      findFirst: jest.fn().mockResolvedValue(current),
      update: jest.fn().mockResolvedValue({}),
    },
    procurementStatusChange: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    procurementOpportunity: { findFirst: jest.fn().mockResolvedValue(current), update: jest.fn() },
    procurementRequirement: {
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'req-1', technicalCertificate: null, ...data })),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    technicalCertificate: { findFirst: jest.fn().mockResolvedValue(null) },
    document: { findFirst: jest.fn().mockResolvedValue({ id: 'doc-1' }) },
    runInTransaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const customers = {
    create: jest.fn().mockResolvedValue({ id: 'cus-new' }),
    findByIdOrThrow: jest.fn().mockResolvedValue({ id: 'cus-1' }),
  };
  const contracts = { create: jest.fn().mockResolvedValue({ id: 'ctr-1' }) };
  const service = new ProcurementService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    {} as CompanyProfileService,
    {} as ComplianceService,
    customers as unknown as CustomersService,
    contracts as unknown as FinanceContractsService,
  );
  jest.spyOn(service, 'getOpportunity').mockResolvedValue({ requirements: [{ id: 'req-1' }] } as never);
  return { service, prisma, tx, audit, customers, contracts };
}

describe('ProcurementService status', () => {
  it('avança uma etapa sob lock e grava o histórico', async () => {
    const { service, tx } = setup();
    await service.changeStatus(ORG, 'op-1', { status: 'ANALISE' }, ACTOR);
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.procurementOpportunity.update).toHaveBeenCalledWith({
      where: { id: 'op-1' },
      data: expect.objectContaining({ status: 'ANALISE' }),
    });
    expect(tx.procurementStatusChange.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ fromStatus: 'RADAR', toStatus: 'ANALISE', reason: null }),
    });
  });

  it('recusa pular etapas', async () => {
    const { service, tx } = setup();
    await expect(service.changeStatus(ORG, 'op-1', { status: 'GANHA' }, ACTOR)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.procurementOpportunity.update).not.toHaveBeenCalled();
  });

  it('descartar exige motivo', async () => {
    const { service } = setup();
    await expect(service.changeStatus(ORG, 'op-1', { status: 'DESCARTADA', reason: '  ' }, ACTOR)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('licitação de outra organização vira 404', async () => {
    const { service, tx } = setup(null);
    await expect(service.changeStatus(ORG, 'op-x', { status: 'ANALISE' }, ACTOR)).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.procurementOpportunity.findFirst).toHaveBeenCalledWith({ where: { id: 'op-x', organizationId: ORG } });
  });
});

describe('ProcurementService edição', () => {
  it('licitação encerrada só aceita anotações', async () => {
    const { service, prisma } = setup(opportunity({ status: 'PERDIDA' }));
    await expect(service.updateOpportunity(ORG, 'op-1', { sessionDate: '2026-12-20' }, ACTOR)).rejects.toBeInstanceOf(
      ConflictException,
    );
    await service.updateOpportunity(ORG, 'op-1', { notes: 'Preço 3% acima do vencedor' }, ACTOR);
    expect(prisma.procurementOpportunity.update).toHaveBeenCalledTimes(1);
  });
});

describe('ProcurementService requisitos', () => {
  it('normaliza o CNAE exigido e grava só os campos do tipo', async () => {
    const { service, prisma } = setup();
    await service.addRequirement(ORG, 'op-1', { type: 'CNAE', description: 'Ramo compatível', requiredCnae: '8219999' }, ACTOR);
    expect(prisma.procurementRequirement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          requiredCnae: '8219-9/99',
          certificateType: null,
          technicalCertificateId: null,
          source: 'MANUAL',
        }),
      }),
    );
  });

  it('recusa CNAE inválido e certidão sem tipo', async () => {
    const { service } = setup();
    await expect(
      service.addRequirement(ORG, 'op-1', { type: 'CNAE', description: 'x', requiredCnae: '123' }, ACTOR),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.addRequirement(ORG, 'op-1', { type: 'CERTIDAO', description: 'x' }, ACTOR)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('não vincula atestado de outra organização', async () => {
    const { service, prisma } = setup();
    await expect(
      service.addRequirement(ORG, 'op-1', { type: 'ATESTADO', description: 'x', technicalCertificateId: 'tc-x' }, ACTOR),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.technicalCertificate.findFirst).toHaveBeenCalledWith({
      where: { id: 'tc-x', organizationId: ORG },
      select: { id: true },
    });
  });

  it('checklist de licitação encerrada não muda', async () => {
    const { service, prisma } = setup(opportunity({ status: 'DESCARTADA' }));
    await expect(service.addRequirement(ORG, 'op-1', { type: 'DOCUMENTO', description: 'x' }, ACTOR)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.procurementRequirement.create).not.toHaveBeenCalled();
  });

  it('marcação manual só vale para documento e declaração', async () => {
    const { service, prisma } = setup();
    prisma.procurementRequirement.findFirst.mockResolvedValue({ id: 'req-1', type: 'CERTIDAO', certificateType: 'CND_FEDERAL' });
    await expect(service.updateRequirement(ORG, 'op-1', 'req-1', { manuallyMet: true }, ACTOR)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('ProcurementService conversão', () => {
  it('só converte licitação ganha', async () => {
    const { service, contracts } = setup(opportunity({ status: 'DISPUTA' }));
    await expect(
      service.convert(ORG, 'op-1', { billing: 'ONE_TIME', valueCents: 100, startDate: '2027-01-01' }, ACTOR),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(contracts.create).not.toHaveBeenCalled();
  });

  it('converte uma vez só', async () => {
    const { service, customers } = setup(opportunity({ status: 'GANHA', contractId: 'ctr-0', convertedAt: new Date() }));
    await expect(
      service.convert(ORG, 'op-1', { billing: 'ONE_TIME', valueCents: 100, startDate: '2027-01-01' }, ACTOR),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(customers.create).not.toHaveBeenCalled();
  });

  it('cria o cliente com o nome do órgão e o contrato pelo Financeiro, sob lock', async () => {
    const { service, tx, customers, contracts } = setup(opportunity({ status: 'GANHA' }));
    await service.convert(ORG, 'op-1', { billing: 'MONTHLY', valueCents: 400_000, startDate: '2027-01-01' }, ACTOR);

    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(customers.create).toHaveBeenCalledWith(
      ORG,
      expect.objectContaining({ name: 'Prefeitura de Exemplo', status: 'ACTIVE', tags: ['licitação'] }),
      'user-1',
    );
    expect(contracts.create).toHaveBeenCalledWith(
      ORG,
      expect.objectContaining({
        customerId: 'cus-new',
        title: 'Licitação 90001/2026: Prefeitura de Exemplo',
        category: 'PROJECT',
        billing: 'MONTHLY',
        valueCents: 400_000,
      }),
      ACTOR,
    );
    expect(tx.procurementOpportunity.update).toHaveBeenCalledWith({
      where: { id: 'op-1' },
      data: expect.objectContaining({ customerId: 'cus-new', contractId: 'ctr-1' }),
    });
  });

  it('usa um cliente existente da organização quando informado', async () => {
    const { service, customers, contracts } = setup(opportunity({ status: 'GANHA' }));
    await service.convert(
      ORG,
      'op-1',
      { customerId: 'cus-1', billing: 'ONE_TIME', valueCents: 100, startDate: '2027-01-01' },
      ACTOR,
    );
    expect(customers.findByIdOrThrow).toHaveBeenCalledWith(ORG, 'cus-1');
    expect(customers.create).not.toHaveBeenCalled();
    expect(contracts.create).toHaveBeenCalledWith(ORG, expect.objectContaining({ customerId: 'cus-1' }), ACTOR);
  });
});
