import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MarketOpportunitiesService } from './market-opportunities.service';

describe('MarketOpportunitiesService', () => {
  let service: MarketOpportunitiesService;
  let prisma: {
    marketOpportunity: { findFirst: jest.Mock; findMany: jest.Mock; update: jest.Mock };
  };
  let auditService: { log: jest.Mock };

  beforeEach(() => {
    prisma = {
      marketOpportunity: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
    };
    auditService = { log: jest.fn() };
    service = new MarketOpportunitiesService(prisma as never, auditService as never);
  });

  describe('findByIdOrThrow', () => {
    it('lança 404 quando a oportunidade não existe ou não pertence à org', async () => {
      prisma.marketOpportunity.findFirst.mockResolvedValue(null);

      await expect(service.findByIdOrThrow('org-1', 'missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('list', () => {
    it('filtra por status quando informado', async () => {
      prisma.marketOpportunity.findMany.mockResolvedValue([]);

      await service.list('org-1', 'NEW');

      expect(prisma.marketOpportunity.findMany).toHaveBeenCalledWith({
        where: { organizationId: 'org-1', status: 'NEW' },
        orderBy: { discoveredAt: 'desc' },
      });
    });

    it('não filtra por status quando omitido', async () => {
      prisma.marketOpportunity.findMany.mockResolvedValue([]);

      await service.list('org-1');

      expect(prisma.marketOpportunity.findMany).toHaveBeenCalledWith({
        where: { organizationId: 'org-1' },
        orderBy: { discoveredAt: 'desc' },
      });
    });
  });

  describe('updateStatus', () => {
    it('atualiza o status e audita com a ação market_opportunity.status_updated', async () => {
      prisma.marketOpportunity.findFirst.mockResolvedValue({ id: 'opp-1', organizationId: 'org-1', status: 'NEW' });
      const updated = { id: 'opp-1', status: 'PURSUING' };
      prisma.marketOpportunity.update.mockResolvedValue(updated);

      const result = await service.updateStatus('org-1', 'opp-1', 'PURSUING', 'user-1');

      expect(prisma.marketOpportunity.update).toHaveBeenCalledWith({
        where: { id: 'opp-1' },
        data: { status: 'PURSUING' },
      });
      expect(auditService.log).toHaveBeenCalledWith({
        actorType: 'USER',
        actorId: 'user-1',
        organizationId: 'org-1',
        action: 'market_opportunity.status_updated',
        resource: 'MarketOpportunity:opp-1',
        metadata: { status: 'PURSUING' },
      });
      expect(result).toBe(updated);
    });

    it('permite todas as transições válidas do enum (NEW/REVIEWING/PURSUING/DISMISSED)', async () => {
      prisma.marketOpportunity.findFirst.mockResolvedValue({ id: 'opp-1', organizationId: 'org-1' });
      prisma.marketOpportunity.update.mockResolvedValue({ id: 'opp-1' });

      for (const status of ['NEW', 'REVIEWING', 'PURSUING', 'DISMISSED'] as const) {
        await expect(service.updateStatus('org-1', 'opp-1', status, 'user-1')).resolves.toBeDefined();
      }
    });

    it('lança 400 e nunca chama o prisma quando o status não pertence ao enum', async () => {
      await expect(
        service.updateStatus('org-1', 'opp-1', 'ARCHIVED' as never, 'user-1'),
      ).rejects.toThrow(BadRequestException);

      expect(prisma.marketOpportunity.findFirst).not.toHaveBeenCalled();
      expect(prisma.marketOpportunity.update).not.toHaveBeenCalled();
      expect(auditService.log).not.toHaveBeenCalled();
    });

    it('lança 404 quando a oportunidade não existe', async () => {
      prisma.marketOpportunity.findFirst.mockResolvedValue(null);

      await expect(service.updateStatus('org-1', 'missing', 'PURSUING', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.marketOpportunity.update).not.toHaveBeenCalled();
    });
  });
});
