import { ConflictException, NotFoundException } from '@nestjs/common';
import { ServiceOfferingsService } from './service-offerings.service';

describe('ServiceOfferingsService', () => {
  let service: ServiceOfferingsService;
  let prisma: {
    serviceOffering: { create: jest.Mock; findFirst: jest.Mock; findMany: jest.Mock; update: jest.Mock; delete: jest.Mock };
  };
  let auditService: { log: jest.Mock };

  beforeEach(() => {
    prisma = {
      serviceOffering: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };
    auditService = { log: jest.fn() };
    service = new ServiceOfferingsService(prisma as never, auditService as never);
  });

  describe('create', () => {
    it('cria a oferta escopada à organização e audita', async () => {
      const created = { id: 'off-1', organizationId: 'org-1', name: 'Automação' };
      prisma.serviceOffering.create.mockResolvedValue(created);

      const result = await service.create('org-1', { name: 'Automação', signals: ['sinal'] }, 'user-1');

      expect(prisma.serviceOffering.create).toHaveBeenCalledWith({
        data: { organizationId: 'org-1', name: 'Automação', signals: ['sinal'] },
      });
      expect(auditService.log).toHaveBeenCalledWith({
        actorType: 'USER',
        actorId: 'user-1',
        organizationId: 'org-1',
        action: 'service_offering.created',
        resource: 'ServiceOffering:off-1',
      });
      expect(result).toBe(created);
    });

    it('lança 409 quando já existe uma oferta com o mesmo nome na organização', async () => {
      prisma.serviceOffering.create.mockRejectedValue({ code: 'P2002' });

      await expect(
        service.create('org-1', { name: 'Automação', signals: [] }, 'user-1'),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('findByIdOrThrow', () => {
    it('lança 404 quando a oferta não existe ou não pertence à org', async () => {
      prisma.serviceOffering.findFirst.mockResolvedValue(null);

      await expect(service.findByIdOrThrow('org-1', 'missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('list', () => {
    it('filtra por isActive quando informado', async () => {
      prisma.serviceOffering.findMany.mockResolvedValue([]);

      await service.list('org-1', { isActive: true });

      expect(prisma.serviceOffering.findMany).toHaveBeenCalledWith({
        where: { organizationId: 'org-1', isActive: true },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('update', () => {
    it('atualiza e audita', async () => {
      prisma.serviceOffering.findFirst.mockResolvedValue({ id: 'off-1', organizationId: 'org-1' });
      const updated = { id: 'off-1', isActive: false };
      prisma.serviceOffering.update.mockResolvedValue(updated);

      const result = await service.update('org-1', 'off-1', { isActive: false }, 'user-1');

      expect(prisma.serviceOffering.update).toHaveBeenCalledWith({
        where: { id: 'off-1' },
        data: { isActive: false },
      });
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'service_offering.updated', resource: 'ServiceOffering:off-1' }),
      );
      expect(result).toBe(updated);
    });
  });

  describe('remove', () => {
    it('remove e audita', async () => {
      prisma.serviceOffering.findFirst.mockResolvedValue({ id: 'off-1', organizationId: 'org-1' });

      await service.remove('org-1', 'off-1', 'user-1');

      expect(prisma.serviceOffering.delete).toHaveBeenCalledWith({ where: { id: 'off-1' } });
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'service_offering.deleted', resource: 'ServiceOffering:off-1' }),
      );
    });
  });
});
