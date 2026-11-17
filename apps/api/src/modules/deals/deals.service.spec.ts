import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DealsService } from './deals.service';

describe('DealsService', () => {
  let service: DealsService;
  let prisma: {
    deal: {
      create: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    customer: { findFirst: jest.Mock };
  };
  let auditService: { log: jest.Mock };
  let activityService: { log: jest.Mock };
  let pipelineHistory: { leadStatusChanged: jest.Mock; dealStageChanged: jest.Mock };

  beforeEach(() => {
    prisma = {
      deal: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      customer: { findFirst: jest.fn() },
    };
    auditService = { log: jest.fn() };
    activityService = { log: jest.fn() };
    pipelineHistory = { leadStatusChanged: jest.fn().mockResolvedValue(undefined), dealStageChanged: jest.fn().mockResolvedValue(undefined) };
    service = new DealsService(
      prisma as never,
      auditService as never,
      activityService as never,
      pipelineHistory as never,
    );
  });

  describe('create', () => {
    it('rejeita quando o customer não pertence à organização', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);

      await expect(
        service.create('org-1', { customerId: 'cust-1', title: 'Contrato X', value: 1000 }, 'user-1'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.deal.create).not.toHaveBeenCalled();
    });

    it('cria o deal em QUALIFICATION e audita', async () => {
      prisma.customer.findFirst.mockResolvedValue({ id: 'cust-1' });
      const created = { id: 'deal-1', organizationId: 'org-1', customerId: 'cust-1', stage: 'QUALIFICATION' };
      prisma.deal.create.mockResolvedValue(created);

      const result = await service.create(
        'org-1',
        { customerId: 'cust-1', title: 'Contrato X', value: 1000 },
        'user-1',
      );

      expect(prisma.deal.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: 'org-1',
          customerId: 'cust-1',
          title: 'Contrato X',
          value: 1000,
          actorType: 'USER',
          actorId: 'user-1',
        }),
      });
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'deal.created', resource: 'Deal:deal-1' }),
      );
      expect(result).toBe(created);
    });
  });

  describe('findByIdOrThrow', () => {
    it('lança 404 quando o deal não existe/não pertence à org', async () => {
      prisma.deal.findFirst.mockResolvedValue(null);

      await expect(service.findByIdOrThrow('org-1', 'missing')).rejects.toThrow(NotFoundException);
    });

    it('lança 404 quando o deal está soft-deletado', async () => {
      prisma.deal.findFirst.mockResolvedValue(null);

      await service.findByIdOrThrow('org-1', 'deal-1').catch(() => undefined);

      expect(prisma.deal.findFirst).toHaveBeenCalledWith({
        where: { id: 'deal-1', organizationId: 'org-1', deletedAt: null },
      });
    });
  });

  describe('update', () => {
    it('nunca aceita "stage" no DTO genérico (tipo não expõe o campo)', async () => {
      prisma.deal.findFirst.mockResolvedValue({ id: 'deal-1', organizationId: 'org-1', deletedAt: null });
      prisma.deal.update.mockResolvedValue({ id: 'deal-1', title: 'Novo título' });

      await service.update('org-1', 'deal-1', { title: 'Novo título' }, 'user-1');

      expect(prisma.deal.update).toHaveBeenCalledWith({
        where: { id: 'deal-1' },
        data: { title: 'Novo título' },
      });
    });
  });

  describe('moveStage', () => {
    it('rejeita transição fora do mapa permitido (ex.: WON -> PROPOSAL)', async () => {
      prisma.deal.findFirst.mockResolvedValue({
        id: 'deal-1',
        organizationId: 'org-1',
        stage: 'WON',
        deletedAt: null,
      });

      await expect(
        service.moveStage('org-1', 'deal-1', { stage: 'PROPOSAL' }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.deal.updateMany).not.toHaveBeenCalled();
    });

    it('exige lostReason ao mover para LOST', async () => {
      prisma.deal.findFirst.mockResolvedValue({
        id: 'deal-1',
        organizationId: 'org-1',
        stage: 'QUALIFICATION',
        deletedAt: null,
      });

      await expect(
        service.moveStage('org-1', 'deal-1', { stage: 'LOST' }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.deal.updateMany).not.toHaveBeenCalled();
    });

    it('move para LOST com lostReason, seta actualCloseDate e registra atividade', async () => {
      prisma.deal.findFirst
        .mockResolvedValueOnce({
          id: 'deal-1',
          organizationId: 'org-1',
          customerId: 'cust-1',
          stage: 'NEGOTIATION',
          deletedAt: null,
        })
        .mockResolvedValueOnce({
          id: 'deal-1',
          organizationId: 'org-1',
          customerId: 'cust-1',
          stage: 'LOST',
          lostReason: 'Preço muito alto',
          value: { toString: () => '1000.00' },
          currency: 'BRL',
        });
      prisma.deal.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.moveStage(
        'org-1',
        'deal-1',
        { stage: 'LOST', lostReason: 'Preço muito alto' },
        'user-1',
      );

      expect(prisma.deal.updateMany).toHaveBeenCalledWith({
        where: { id: 'deal-1', organizationId: 'org-1', stage: 'NEGOTIATION', deletedAt: null },
        data: expect.objectContaining({
          stage: 'LOST',
          lostReason: 'Preço muito alto',
          actualCloseDate: expect.any(Date),
        }),
      });
      expect(activityService.log).toHaveBeenCalledWith(
        expect.objectContaining({ customerId: 'cust-1', type: 'deal.lost' }),
      );
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'deal.stage_changed' }),
      );
      expect(result.stage).toBe('LOST');
    });

    it('move para WON, seta actualCloseDate e registra atividade deal.won', async () => {
      prisma.deal.findFirst
        .mockResolvedValueOnce({
          id: 'deal-1',
          organizationId: 'org-1',
          customerId: 'cust-1',
          stage: 'CONTRACT_SENT',
          deletedAt: null,
        })
        .mockResolvedValueOnce({
          id: 'deal-1',
          organizationId: 'org-1',
          customerId: 'cust-1',
          stage: 'WON',
          value: { toString: () => '5000.00' },
          currency: 'BRL',
        });
      prisma.deal.updateMany.mockResolvedValue({ count: 1 });

      await service.moveStage('org-1', 'deal-1', { stage: 'WON' }, 'user-1');

      expect(activityService.log).toHaveBeenCalledWith(
        expect.objectContaining({ customerId: 'cust-1', type: 'deal.won' }),
      );
    });

    it('lança conflito de concorrência quando o estágio mudou entre a leitura e a escrita', async () => {
      prisma.deal.findFirst
        .mockResolvedValueOnce({
          id: 'deal-1',
          organizationId: 'org-1',
          customerId: 'cust-1',
          stage: 'QUALIFICATION',
          deletedAt: null,
        })
        .mockResolvedValueOnce({
          id: 'deal-1',
          organizationId: 'org-1',
          stage: 'PROPOSAL',
        });
      prisma.deal.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.moveStage('org-1', 'deal-1', { stage: 'NEGOTIATION' }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('atualiza stageEnteredAt para agora em toda transição de etapa bem-sucedida', async () => {
      const deal = { id: 'deal-1', organizationId: 'org-1', stage: 'QUALIFICATION', stageEnteredAt: new Date('2020-01-01') };
      prisma.deal.findFirst.mockResolvedValueOnce(deal).mockResolvedValueOnce({ ...deal, stage: 'PROPOSAL' });
      prisma.deal.updateMany.mockResolvedValue({ count: 1 });

      await service.moveStage('org-1', 'deal-1', { stage: 'PROPOSAL' }, 'user-1');

      expect(prisma.deal.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ stage: 'PROPOSAL', stageEnteredAt: expect.any(Date) }) }),
      );
    });

    it('reseta stageEnteredAt também ao reabrir um deal de LOST para QUALIFICATION', async () => {
      const deal = { id: 'deal-1', organizationId: 'org-1', stage: 'LOST', stageEnteredAt: new Date('2000-01-01') };
      prisma.deal.findFirst.mockResolvedValueOnce(deal).mockResolvedValueOnce({ ...deal, stage: 'QUALIFICATION' });
      prisma.deal.updateMany.mockResolvedValue({ count: 1 });

      await service.moveStage('org-1', 'deal-1', { stage: 'QUALIFICATION' }, 'user-1');

      expect(prisma.deal.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ stage: 'QUALIFICATION', stageEnteredAt: expect.any(Date), lostReason: null }) }),
      );
    });
  });

  describe('remove', () => {
    it('faz soft-delete (seta deletedAt, não apaga a linha)', async () => {
      prisma.deal.findFirst.mockResolvedValue({ id: 'deal-1', organizationId: 'org-1', deletedAt: null });
      prisma.deal.update.mockResolvedValue({ id: 'deal-1', deletedAt: new Date() });

      await service.remove('org-1', 'deal-1', 'user-1');

      expect(prisma.deal.update).toHaveBeenCalledWith({
        where: { id: 'deal-1' },
        data: { deletedAt: expect.any(Date) },
      });
    });
  });
});
