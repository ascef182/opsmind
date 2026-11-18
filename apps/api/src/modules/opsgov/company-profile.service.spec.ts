import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { CompanyProfileService } from './company-profile.service';
import type { PrismaService } from '../../infrastructure/database/prisma.service';
import type { AuditService } from '../audit/audit.service';

const ORG = 'org-1';
const ACTOR = { type: 'USER', id: 'user-1' } as never;

function period(over: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    organizationId: ORG,
    validFrom: new Date('2024-03-01'),
    validTo: null,
    notes: null,
    documentId: null,
    actorType: 'USER',
    actorId: 'user-1',
    createdAt: new Date('2024-03-01T00:00:00Z'),
    ...over,
  };
}

const mei = period({ regime: 'SIMEI', ibsCbsMode: 'NAO_SE_APLICA' });

function activity(over: Record<string, unknown> = {}) {
  return period({
    id: 'a1',
    cnae: '8219-9/99',
    description: 'Preparação de documentos',
    isPrimary: true,
    anexoSimples: 'NAO_DEFINIDO',
    revenueGroup: 'OUTROS',
    ...over,
  });
}

function setup(state: { regimes?: unknown[]; registrations?: unknown[]; activities?: unknown[] } = {}) {
  const model = (rows: unknown[] = []) => ({
    findMany: jest.fn().mockResolvedValue(rows),
    findFirst: jest.fn().mockResolvedValue(rows[0] ?? null),
    update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...(rows[0] as object), ...data })),
    create: jest.fn().mockImplementation(({ data }) => Promise.resolve(period({ id: 'new', ...data }))),
  });
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    taxRegimePeriod: model(state.regimes),
    companyRegistrationPeriod: model(state.registrations),
    companyActivity: model(state.activities),
    companyProfile: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
  const prisma = {
    document: { findFirst: jest.fn().mockResolvedValue({ id: 'doc-1' }) },
    runInTransaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const service = new CompanyProfileService(prisma as unknown as PrismaService, audit as unknown as AuditService);
  return { service, prisma, tx, audit };
}

describe('CompanyProfileService.changeRegime', () => {
  it('fecha o vigente e abre o novo na mesma transação, sob advisory lock', async () => {
    const { service, tx, prisma, audit } = setup({ regimes: [mei] });

    const view = await service.changeRegime(
      ORG,
      { regime: 'SIMPLES_NACIONAL', ibsCbsMode: 'DENTRO_DAS', validFrom: '2027-01-01' },
      ACTOR,
    );

    expect(prisma.runInTransaction).toHaveBeenCalledTimes(1);
    expect(tx.$executeRaw).toHaveBeenCalled();
    expect(tx.taxRegimePeriod.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { validTo: new Date('2027-01-01') },
    });
    expect(tx.taxRegimePeriod.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: ORG,
        regime: 'SIMPLES_NACIONAL',
        validFrom: new Date('2027-01-01'),
        actorType: 'USER',
        actorId: 'user-1',
      }),
    });
    expect(view).toEqual(expect.objectContaining({ regime: 'SIMPLES_NACIONAL', validFrom: '2027-01-01', validTo: null }));
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'opsgov.regime.changed' }));
  });

  it('recusa vigência que começa antes ou no mesmo dia do vigente, sem escrever nada', async () => {
    const { service, tx } = setup({ regimes: [mei] });

    await expect(
      service.changeRegime(ORG, { regime: 'SIMPLES_NACIONAL', ibsCbsMode: 'DENTRO_DAS', validFrom: '2024-03-01' }, ACTOR),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.changeRegime(ORG, { regime: 'SIMPLES_NACIONAL', ibsCbsMode: 'DENTRO_DAS', validFrom: '2023-01-01' }, ACTOR),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.taxRegimePeriod.update).not.toHaveBeenCalled();
    expect(tx.taxRegimePeriod.create).not.toHaveBeenCalled();
  });

  it('recusa sobreposição com período já encerrado', async () => {
    const closed = period({ id: 'old', regime: 'SIMEI', validFrom: new Date('2020-01-01'), validTo: new Date('2024-01-01') });
    const { service, tx } = setup({ regimes: [closed] });

    await expect(
      service.changeRegime(ORG, { regime: 'SIMEI', ibsCbsMode: 'NAO_SE_APLICA', validFrom: '2023-06-01' }, ACTOR),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.taxRegimePeriod.create).not.toHaveBeenCalled();
  });

  it('traduz a violação do EXCLUDE do banco (corrida) em 409', async () => {
    const { service, tx } = setup({ regimes: [] });
    tx.taxRegimePeriod.create.mockRejectedValue(
      new Error('conflicting key value violates exclusion constraint "tax_regime_periods_no_overlap"'),
    );

    await expect(
      service.changeRegime(ORG, { regime: 'SIMEI', ibsCbsMode: 'NAO_SE_APLICA', validFrom: '2024-03-01' }, ACTOR),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('recusa SIMEI com IBS/CBS no regime regular', async () => {
    const { service } = setup();
    await expect(
      service.changeRegime(ORG, { regime: 'SIMEI', ibsCbsMode: 'REGULAR', validFrom: '2024-03-01' }, ACTOR),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('comprovante de outra organização não é aceito', async () => {
    const { service, prisma, tx } = setup();
    prisma.document.findFirst.mockResolvedValue(null);

    await expect(
      service.changeRegime(
        ORG,
        { regime: 'SIMEI', ibsCbsMode: 'NAO_SE_APLICA', validFrom: '2024-03-01', documentId: 'doc-x' },
        ACTOR,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.document.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'doc-x', organizationId: ORG, deletedAt: null } }),
    );
    expect(tx.taxRegimePeriod.create).not.toHaveBeenCalled();
  });
});

describe('CompanyProfileService.changeRegistration', () => {
  it('Cenário B: novo CNPJ fecha o cadastro MEI e atualiza o CNPJ de exibição', async () => {
    const current = period({ naturezaJuridica: 'MEI', cnpj: '11222333000181' });
    const { service, tx } = setup({ registrations: [current] });

    await service.changeRegistration(
      ORG,
      { naturezaJuridica: 'SLU', cnpj: '11.444.777/0001-61', validFrom: '2027-01-01' },
      ACTOR,
    );

    expect(tx.companyRegistrationPeriod.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { validTo: new Date('2027-01-01') },
    });
    expect(tx.companyRegistrationPeriod.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ naturezaJuridica: 'SLU', cnpj: '11444777000161' }),
    });
    expect(tx.companyProfile.updateMany).toHaveBeenCalledWith({ where: { organizationId: ORG }, data: { cnpj: '11444777000161' } });
  });

  it('recusa CNPJ com dígito verificador inválido', async () => {
    const { service, prisma } = setup();
    await expect(
      service.changeRegistration(ORG, { naturezaJuridica: 'MEI', cnpj: '11222333000182', validFrom: '2024-03-01' }, ACTOR),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.runInTransaction).not.toHaveBeenCalled();
  });
});

describe('CompanyProfileService atividades', () => {
  it('adiciona CNAE normalizado', async () => {
    const { service, tx } = setup({ activities: [] });
    await service.addActivity(
      ORG,
      { cnae: '85.99-6-99', description: 'Treinamento', validFrom: '2024-03-01', revenueGroup: 'TRADUCAO_LEGENDAGEM' },
      ACTOR,
    );
    expect(tx.companyActivity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ cnae: '8599-6/99', isPrimary: false, revenueGroup: 'TRADUCAO_LEGENDAGEM' }),
    });
  });

  it('recusa o mesmo CNAE com vigência sobreposta', async () => {
    const { service, tx } = setup({ activities: [activity()] });
    await expect(
      service.addActivity(ORG, { cnae: '8219-9/99', description: 'Dup', validFrom: '2025-01-01' }, ACTOR),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.companyActivity.create).not.toHaveBeenCalled();
  });

  it('recusa uma segunda atividade principal no mesmo período', async () => {
    const { service } = setup({ activities: [activity()] });
    await expect(
      service.addActivity(ORG, { cnae: '6201-5/01', description: 'Software', isPrimary: true, validFrom: '2027-01-01' }, ACTOR),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('nova versão de atividade fecha a vigente e herda os campos não informados', async () => {
    const { service, tx } = setup({ activities: [activity()] });
    await service.changeActivity(ORG, 'a1', { validFrom: '2027-01-01', anexoSimples: 'III' }, ACTOR);

    expect(tx.companyActivity.update).toHaveBeenCalledWith({ where: { id: 'a1' }, data: { validTo: new Date('2027-01-01') } });
    expect(tx.companyActivity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ cnae: '8219-9/99', isPrimary: true, anexoSimples: 'III', description: 'Preparação de documentos' }),
    });
  });

  it('versão encerrada não pode ser alterada', async () => {
    const { service } = setup({ activities: [activity({ validTo: new Date('2025-01-01') })] });
    await expect(service.changeActivity(ORG, 'a1', { validFrom: '2027-01-01' }, ACTOR)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('encerramento precisa ser depois do início', async () => {
    const { service } = setup({ activities: [activity()] });
    await expect(service.endActivity(ORG, 'a1', { validTo: '2024-03-01' }, ACTOR)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
