import { NotFoundException } from '@nestjs/common';
import { LeadSignalsService } from './lead-signals.service';

describe('LeadSignalsService', () => {
  function buildDeps() {
    const prisma = { leadSignal: { findMany: jest.fn() } };
    const leadsService = { findByIdOrThrow: jest.fn() };
    const websiteProfileQueueService = { enqueue: jest.fn() };
    const service = new LeadSignalsService(
      prisma as never,
      leadsService as never,
      websiteProfileQueueService as never,
    );
    return { service, prisma, leadsService, websiteProfileQueueService };
  }

  describe('listForLead', () => {
    it('confirma que o lead existe na organização (404, não lista vazia, pra lead inexistente/cross-tenant) antes de listar', async () => {
      const { service, prisma, leadsService } = buildDeps();
      leadsService.findByIdOrThrow.mockResolvedValue({ id: 'lead-1' });
      prisma.leadSignal.findMany.mockResolvedValue([{ id: 'sig-1' }]);

      const result = await service.listForLead('org-1', 'lead-1');

      expect(leadsService.findByIdOrThrow).toHaveBeenCalledWith('org-1', 'lead-1');
      expect(prisma.leadSignal.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organizationId: 'org-1', leadId: 'lead-1' } }),
      );
      expect(result).toEqual([{ id: 'sig-1' }]);
    });

    it('propaga o NotFoundException de findByIdOrThrow sem nem chamar findMany', async () => {
      const { service, prisma, leadsService } = buildDeps();
      leadsService.findByIdOrThrow.mockRejectedValue(new NotFoundException());

      await expect(service.listForLead('org-1', 'lead-inexistente')).rejects.toThrow(NotFoundException);
      expect(prisma.leadSignal.findMany).not.toHaveBeenCalled();
    });
  });

  describe('requestInvestigation', () => {
    it('enfileira a investigação quando o lead tem website conhecido', async () => {
      const { service, leadsService, websiteProfileQueueService } = buildDeps();
      leadsService.findByIdOrThrow.mockResolvedValue({ id: 'lead-1', website: 'https://exemplo.com.br' });

      await service.requestInvestigation('org-1', 'lead-1', 'user-1');

      expect(websiteProfileQueueService.enqueue).toHaveBeenCalledWith({
        trigger: 'MANUAL',
        organizationId: 'org-1',
        leadId: 'lead-1',
        actorType: 'USER',
        actorId: 'user-1',
      });
    });

    it('lança NotFoundException e nunca enfileira quando o lead não tem website', async () => {
      const { service, leadsService, websiteProfileQueueService } = buildDeps();
      leadsService.findByIdOrThrow.mockResolvedValue({ id: 'lead-1', website: null });

      await expect(service.requestInvestigation('org-1', 'lead-1', 'user-1')).rejects.toThrow(NotFoundException);
      expect(websiteProfileQueueService.enqueue).not.toHaveBeenCalled();
    });
  });

  describe('mapToOfferings', () => {
    it('agrupa sinais CONFIRMADOS por oferta, sempre com evidência junto', async () => {
      const { service, prisma, leadsService } = buildDeps();
      leadsService.findByIdOrThrow.mockResolvedValue({ id: 'lead-1' });
      prisma.leadSignal.findMany.mockResolvedValue([
        {
          signalCode: 'website.no_ssl',
          confidence: { toString: () => '1' },
          evidenceUrl: 'https://a.com/',
          evidenceQuote: null,
          signalCodeRef: { status: 'CONFIRMED', label: 'Site sem HTTPS', defaultServiceOfferingId: 'off-1' },
        },
        {
          signalCode: 'website.no_contact_form',
          confidence: { toString: () => '0.6' },
          evidenceUrl: 'https://a.com/',
          evidenceQuote: null,
          signalCodeRef: { status: 'CONFIRMED', label: 'Sem formulário', defaultServiceOfferingId: 'off-1' },
        },
      ]);

      const result = await service.mapToOfferings('org-1', 'lead-1');

      expect(result).toEqual([
        {
          offeringId: 'off-1',
          matchedSignalCodes: ['website.no_ssl', 'website.no_contact_form'],
          evidence: [
            { signalCode: 'website.no_ssl', label: 'Site sem HTTPS', confidence: '1', evidenceUrl: 'https://a.com/', evidenceQuote: null },
            { signalCode: 'website.no_contact_form', label: 'Sem formulário', confidence: '0.6', evidenceUrl: 'https://a.com/', evidenceQuote: null },
          ],
        },
      ]);
    });

    it('nunca inclui sinal PROPOSED/DEPRECATED nem sem oferta padrão', async () => {
      const { service, prisma, leadsService } = buildDeps();
      leadsService.findByIdOrThrow.mockResolvedValue({ id: 'lead-1' });
      prisma.leadSignal.findMany.mockResolvedValue([
        {
          signalCode: 'custom.proposto',
          confidence: { toString: () => '0.5' },
          evidenceUrl: null,
          evidenceQuote: null,
          signalCodeRef: { status: 'PROPOSED', label: 'x', defaultServiceOfferingId: 'off-1' },
        },
        {
          signalCode: 'website.sem_offering_padrao',
          confidence: { toString: () => '0.5' },
          evidenceUrl: null,
          evidenceQuote: null,
          signalCodeRef: { status: 'CONFIRMED', label: 'y', defaultServiceOfferingId: null },
        },
      ]);

      const result = await service.mapToOfferings('org-1', 'lead-1');

      expect(result).toEqual([]);
    });

    it('usa só a observação mais recente de cada signalCode (não soma duplicatas entre runs)', async () => {
      const { service, prisma, leadsService } = buildDeps();
      leadsService.findByIdOrThrow.mockResolvedValue({ id: 'lead-1' });
      prisma.leadSignal.findMany.mockResolvedValue([
        {
          signalCode: 'website.no_ssl',
          confidence: { toString: () => '1' },
          evidenceUrl: 'run-mais-recente',
          evidenceQuote: null,
          signalCodeRef: { status: 'CONFIRMED', label: 'Site sem HTTPS', defaultServiceOfferingId: 'off-1' },
        },
        {
          signalCode: 'website.no_ssl',
          confidence: { toString: () => '1' },
          evidenceUrl: 'run-antigo',
          evidenceQuote: null,
          signalCodeRef: { status: 'CONFIRMED', label: 'Site sem HTTPS', defaultServiceOfferingId: 'off-1' },
        },
      ]);

      const result = await service.mapToOfferings('org-1', 'lead-1');

      expect(result).toHaveLength(1);
      expect(result[0]?.evidence).toHaveLength(1);
      expect(result[0]?.evidence[0]?.evidenceUrl).toBe('run-mais-recente');
    });
  });
});
