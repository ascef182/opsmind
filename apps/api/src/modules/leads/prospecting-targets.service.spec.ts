import { ConflictException, NotFoundException } from '@nestjs/common';
import { ProspectingTargetsService } from './prospecting-targets.service';

describe('ProspectingTargetsService', () => {
  let service: ProspectingTargetsService;
  let prisma: {
    prospectingTarget: {
      create: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
  };
  let auditService: { log: jest.Mock };
  let scrapeJobsService: { create: jest.Mock };

  beforeEach(() => {
    prisma = {
      prospectingTarget: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };
    auditService = { log: jest.fn() };
    scrapeJobsService = { create: jest.fn().mockResolvedValue({ id: 'job-1' }) };
    service = new ProspectingTargetsService(prisma as never, auditService as never, scrapeJobsService as never);
  });

  describe('create', () => {
    it('cria o alvo com defaults (sourceType/onlyWithoutWebsite/isActive/cooldownDays) e audita', async () => {
      const created = {
        id: 'target-1',
        organizationId: 'org-1',
        city: 'São Paulo',
        state: 'SP',
        businessType: 'padaria',
        sourceType: 'APIFY_GOOGLE_MAPS',
      };
      prisma.prospectingTarget.create.mockResolvedValue(created);

      const result = await service.create(
        'org-1',
        { city: 'São Paulo', state: 'SP', businessType: 'padaria' },
        'user-1',
      );

      expect(prisma.prospectingTarget.create).toHaveBeenCalledWith({
        data: {
          organizationId: 'org-1',
          city: 'São Paulo',
          state: 'SP',
          businessType: 'padaria',
          sourceType: 'APIFY_GOOGLE_MAPS',
          onlyWithoutWebsite: true,
          isActive: true,
          cooldownDays: 7,
        },
      });
      expect(auditService.log).toHaveBeenCalledWith({
        actorType: 'USER',
        actorId: 'user-1',
        organizationId: 'org-1',
        action: 'prospecting_target.created',
        resource: 'ProspectingTarget:target-1',
        metadata: {
          city: 'São Paulo',
          state: 'SP',
          businessType: 'padaria',
          sourceType: 'APIFY_GOOGLE_MAPS',
        },
      });
      expect(result).toBe(created);
    });

    it('respeita sourceType/onlyWithoutWebsite/limit/isActive/cooldownDays explícitos', async () => {
      prisma.prospectingTarget.create.mockResolvedValue({ id: 'target-2' });

      await service.create(
        'org-1',
        {
          city: 'Rio',
          state: 'RJ',
          businessType: 'oficina',
          sourceType: 'EXPLORIUM_BUSINESS_SEARCH',
          onlyWithoutWebsite: false,
          limit: 25,
          isActive: false,
          cooldownDays: 30,
        },
        'user-1',
      );

      expect(prisma.prospectingTarget.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          sourceType: 'EXPLORIUM_BUSINESS_SEARCH',
          onlyWithoutWebsite: false,
          limit: 25,
          isActive: false,
          cooldownDays: 30,
        }),
      });
    });

    it('lança 409 quando já existe um alvo com a mesma combinação city/state/businessType/sourceType', async () => {
      prisma.prospectingTarget.create.mockRejectedValue({ code: 'P2002' });

      await expect(
        service.create('org-1', { city: 'São Paulo', state: 'SP', businessType: 'padaria' }, 'user-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('dispara um scan imediato (ScrapeJobsService.create) quando o alvo criado está ativo', async () => {
      prisma.prospectingTarget.create.mockResolvedValue({
        id: 'target-1',
        city: 'São Paulo',
        state: 'SP',
        businessType: 'Barbearias',
        sourceType: 'APIFY_GOOGLE_MAPS',
        onlyWithoutWebsite: true,
        limit: 50,
        isActive: true,
      });

      await service.create(
        'org-1',
        { city: 'São Paulo', state: 'SP', businessType: 'Barbearias' },
        'user-1',
      );

      expect(scrapeJobsService.create).toHaveBeenCalledWith(
        'org-1',
        {
          sourceType: 'APIFY_GOOGLE_MAPS',
          city: 'São Paulo',
          state: 'SP',
          businessType: 'Barbearias',
          onlyWithoutWebsite: true,
          limit: 50,
        },
        'user-1',
      );
    });

    it('não dispara scan quando o alvo criado já nasce inativo', async () => {
      prisma.prospectingTarget.create.mockResolvedValue({
        id: 'target-1',
        city: 'São Paulo',
        state: 'SP',
        businessType: 'Barbearias',
        sourceType: 'APIFY_GOOGLE_MAPS',
        onlyWithoutWebsite: true,
        limit: null,
        isActive: false,
      });

      await service.create(
        'org-1',
        { city: 'São Paulo', state: 'SP', businessType: 'Barbearias', isActive: false },
        'user-1',
      );

      expect(scrapeJobsService.create).not.toHaveBeenCalled();
    });

    it('não deixa uma falha ao disparar o scan imediato derrubar a criação do alvo', async () => {
      const created = {
        id: 'target-1',
        city: 'São Paulo',
        state: 'SP',
        businessType: 'Barbearias',
        sourceType: 'APIFY_GOOGLE_MAPS',
        onlyWithoutWebsite: true,
        limit: null,
        isActive: true,
      };
      prisma.prospectingTarget.create.mockResolvedValue(created);
      scrapeJobsService.create.mockRejectedValue(new Error('fila indisponível'));

      const result = await service.create(
        'org-1',
        { city: 'São Paulo', state: 'SP', businessType: 'Barbearias' },
        'user-1',
      );

      expect(result).toBe(created);
    });
  });

  describe('findByIdOrThrow', () => {
    it('lança 404 quando o alvo não existe ou não pertence à org', async () => {
      prisma.prospectingTarget.findFirst.mockResolvedValue(null);

      await expect(service.findByIdOrThrow('org-1', 'missing')).rejects.toThrow(NotFoundException);
    });

    it('retorna o alvo quando encontrado escopado à org', async () => {
      const found = { id: 'target-1', organizationId: 'org-1' };
      prisma.prospectingTarget.findFirst.mockResolvedValue(found);

      const result = await service.findByIdOrThrow('org-1', 'target-1');

      expect(prisma.prospectingTarget.findFirst).toHaveBeenCalledWith({
        where: { id: 'target-1', organizationId: 'org-1' },
      });
      expect(result).toBe(found);
    });
  });

  describe('list', () => {
    it('lista sem filtro de isActive quando não informado', async () => {
      prisma.prospectingTarget.findMany.mockResolvedValue([]);

      await service.list('org-1');

      expect(prisma.prospectingTarget.findMany).toHaveBeenCalledWith({
        where: { organizationId: 'org-1' },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('filtra por isActive quando informado', async () => {
      prisma.prospectingTarget.findMany.mockResolvedValue([]);

      await service.list('org-1', { isActive: true });

      expect(prisma.prospectingTarget.findMany).toHaveBeenCalledWith({
        where: { organizationId: 'org-1', isActive: true },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('update', () => {
    it('atualiza e audita', async () => {
      prisma.prospectingTarget.findFirst.mockResolvedValue({ id: 'target-1', organizationId: 'org-1' });
      const updated = { id: 'target-1', isActive: false };
      prisma.prospectingTarget.update.mockResolvedValue(updated);

      const result = await service.update('org-1', 'target-1', { isActive: false }, 'user-1');

      expect(prisma.prospectingTarget.update).toHaveBeenCalledWith({
        where: { id: 'target-1' },
        data: { isActive: false },
      });
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'prospecting_target.updated',
          resource: 'ProspectingTarget:target-1',
        }),
      );
      expect(result).toBe(updated);
    });

    it('lança 404 quando o alvo não existe', async () => {
      prisma.prospectingTarget.findFirst.mockResolvedValue(null);

      await expect(
        service.update('org-1', 'missing', { isActive: false }, 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('lança 409 quando a atualização colide com outro alvo existente', async () => {
      prisma.prospectingTarget.findFirst.mockResolvedValue({ id: 'target-1', organizationId: 'org-1' });
      prisma.prospectingTarget.update.mockRejectedValue({ code: 'P2002' });

      await expect(
        service.update('org-1', 'target-1', { city: 'Rio' }, 'user-1'),
      ).rejects.toThrow(ConflictException);
    });

    const baseTarget = {
      id: 'target-1',
      organizationId: 'org-1',
      city: 'São Paulo',
      state: 'SP',
      businessType: 'Barbearias',
      sourceType: 'APIFY_GOOGLE_MAPS',
      onlyWithoutWebsite: true,
      limit: 50,
    };

    it('dispara um scan imediato quando isActive transiciona de false para true (reativação)', async () => {
      prisma.prospectingTarget.findFirst.mockResolvedValue({ ...baseTarget, isActive: false });
      prisma.prospectingTarget.update.mockResolvedValue({ ...baseTarget, isActive: true });

      await service.update('org-1', 'target-1', { isActive: true }, 'user-1');

      expect(scrapeJobsService.create).toHaveBeenCalledWith(
        'org-1',
        {
          sourceType: 'APIFY_GOOGLE_MAPS',
          city: 'São Paulo',
          state: 'SP',
          businessType: 'Barbearias',
          onlyWithoutWebsite: true,
          limit: 50,
        },
        'user-1',
      );
    });

    it('não dispara scan quando isActive já era true e continua true', async () => {
      prisma.prospectingTarget.findFirst.mockResolvedValue({ ...baseTarget, isActive: true });
      prisma.prospectingTarget.update.mockResolvedValue({ ...baseTarget, city: 'Rio', isActive: true });

      await service.update('org-1', 'target-1', { city: 'Rio' }, 'user-1');

      expect(scrapeJobsService.create).not.toHaveBeenCalled();
    });

    it('não dispara scan quando isActive transiciona de true para false', async () => {
      prisma.prospectingTarget.findFirst.mockResolvedValue({ ...baseTarget, isActive: true });
      prisma.prospectingTarget.update.mockResolvedValue({ ...baseTarget, isActive: false });

      await service.update('org-1', 'target-1', { isActive: false }, 'user-1');

      expect(scrapeJobsService.create).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('remove e audita', async () => {
      prisma.prospectingTarget.findFirst.mockResolvedValue({ id: 'target-1', organizationId: 'org-1' });

      await service.remove('org-1', 'target-1', 'user-1');

      expect(prisma.prospectingTarget.delete).toHaveBeenCalledWith({ where: { id: 'target-1' } });
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'prospecting_target.removed',
          resource: 'ProspectingTarget:target-1',
        }),
      );
    });

    it('lança 404 quando o alvo não existe', async () => {
      prisma.prospectingTarget.findFirst.mockResolvedValue(null);

      await expect(service.remove('org-1', 'missing', 'user-1')).rejects.toThrow(NotFoundException);
    });
  });
});
