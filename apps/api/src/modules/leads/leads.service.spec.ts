import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@opsmind/database';
import { LeadsService } from './leads.service';
import type { SocialLinkDto } from './dto/social-link.dto';

describe('LeadsService', () => {
  let service: LeadsService;
  let prisma: {
    lead: {
      create: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      groupBy: jest.Mock;
    };
    serviceOffering: { findMany: jest.Mock };
    leadEnrichment: { findFirst: jest.Mock; create: jest.Mock };
    customer: { create: jest.Mock };
    membership: { findMany: jest.Mock; findFirst: jest.Mock };
  };
  let auditService: { log: jest.Mock };
  let exploriumGateway: { searchBusinesses: jest.Mock; matchBusiness: jest.Mock };
  let dealsService: { create: jest.Mock };

  beforeEach(() => {
    prisma = {
      lead: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      serviceOffering: { findMany: jest.fn() },
      leadEnrichment: { findFirst: jest.fn(), create: jest.fn() },
      customer: { create: jest.fn() },
      membership: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn() },
    };
    auditService = { log: jest.fn() };
    exploriumGateway = { searchBusinesses: jest.fn(), matchBusiness: jest.fn() };
    dealsService = { create: jest.fn().mockResolvedValue({ id: 'deal-1' }) };
    service = new LeadsService(
      prisma as never,
      auditService as never,
      exploriumGateway as never,
      dealsService as never,
    );
  });

  describe('create', () => {
    it('cria o lead com sourceType MANUAL e audita', async () => {
      const created = { id: 'lead-1', organizationId: 'org-1', name: 'Padaria Central' };
      prisma.lead.create.mockResolvedValue(created);

      const result = await service.create('org-1', { name: 'Padaria Central' }, 'user-1');

      expect(prisma.lead.create).toHaveBeenCalledWith({
        data: {
          organizationId: 'org-1',
          sourceType: 'MANUAL',
          actorType: 'USER',
          actorId: 'user-1',
          name: 'Padaria Central',
        },
      });
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'lead.created', resource: 'Lead:lead-1' }),
      );
      expect(result).toBe(created);
    });

    it('atribui o lead recém-criado automaticamente (round-robin) quando há membros elegíveis', async () => {
      const created = { id: 'lead-1', organizationId: 'org-1', name: 'Padaria Central', status: 'DISCOVERED' };
      prisma.lead.create.mockResolvedValue(created);
      prisma.membership.findMany.mockResolvedValue([{ userId: 'user-a' }]);
      prisma.lead.groupBy.mockResolvedValue([]);
      prisma.lead.update.mockResolvedValue({ ...created, assignedUserId: 'user-a' });

      const result = await service.create('org-1', { name: 'Padaria Central' }, 'user-1');

      expect(prisma.lead.update).toHaveBeenCalledWith({
        where: { id: 'lead-1' },
        data: { assignedUserId: 'user-a' },
      });
      expect(result.assignedUserId).toBe('user-a');
    });

    it('repassa socialLinks/whatsapp/contactName pro Prisma quando presentes no DTO', async () => {
      const created = { id: 'lead-1', organizationId: 'org-1', name: 'Padaria Central' };
      prisma.lead.create.mockResolvedValue(created);
      const socialLinks: SocialLinkDto[] = [
        { platform: 'INSTAGRAM', url: 'https://instagram.com/padaria' },
      ];

      await service.create(
        'org-1',
        { name: 'Padaria Central', whatsapp: '+5511900000000', contactName: 'Maria Silva', socialLinks },
        'user-1',
      );

      expect(prisma.lead.create).toHaveBeenCalledWith({
        data: {
          organizationId: 'org-1',
          sourceType: 'MANUAL',
          actorType: 'USER',
          actorId: 'user-1',
          name: 'Padaria Central',
          whatsapp: '+5511900000000',
          contactName: 'Maria Silva',
          socialLinks,
        },
      });
    });
  });

  describe('findByIdOrThrow', () => {
    it('lança 404 quando o lead não existe/não pertence à org', async () => {
      prisma.lead.findFirst.mockResolvedValue(null);

      await expect(service.findByIdOrThrow('org-1', 'missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('rejeita PATCH com status CONVERTED (transição exclusiva de convertToCustomer)', async () => {
      prisma.lead.findFirst.mockResolvedValue({
        id: 'lead-1',
        organizationId: 'org-1',
        status: 'QUALIFIED',
        convertedCustomerId: null,
      });

      await expect(
        service.update('org-1', 'lead-1', { status: 'CONVERTED' }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.lead.update).not.toHaveBeenCalled();
    });

    it('rejeita PATCH de status em um lead já convertido', async () => {
      prisma.lead.findFirst.mockResolvedValue({
        id: 'lead-1',
        organizationId: 'org-1',
        status: 'CONVERTED',
        convertedCustomerId: 'cust-1',
      });

      await expect(
        service.update('org-1', 'lead-1', { status: 'DISCOVERED' }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.lead.update).not.toHaveBeenCalled();
    });

    it('permite uma mudança de status legítima em um lead não convertido (regressão)', async () => {
      prisma.lead.findFirst.mockResolvedValue({
        id: 'lead-1',
        organizationId: 'org-1',
        status: 'QUALIFIED',
        convertedCustomerId: null,
      });
      const updated = { id: 'lead-1', status: 'LOST' };
      prisma.lead.update.mockResolvedValue(updated);

      const result = await service.update('org-1', 'lead-1', { status: 'LOST' }, 'user-1');

      expect(prisma.lead.update).toHaveBeenCalledWith({
        where: { id: 'lead-1' },
        data: { status: 'LOST' },
      });
      expect(result).toBe(updated);
    });

    it('permite PATCH sem alterar status em um lead já convertido (ex.: corrigir telefone)', async () => {
      prisma.lead.findFirst.mockResolvedValue({
        id: 'lead-1',
        organizationId: 'org-1',
        status: 'CONVERTED',
        convertedCustomerId: 'cust-1',
      });
      const updated = { id: 'lead-1', phone: '999' };
      prisma.lead.update.mockResolvedValue(updated);

      const result = await service.update('org-1', 'lead-1', { phone: '999' }, 'user-1');

      expect(prisma.lead.update).toHaveBeenCalledWith({
        where: { id: 'lead-1' },
        data: { phone: '999' },
      });
      expect(result).toBe(updated);
    });

    it('repassa socialLinks/whatsapp/contactName pro Prisma quando presentes no DTO', async () => {
      prisma.lead.findFirst.mockResolvedValue({
        id: 'lead-1',
        organizationId: 'org-1',
        status: 'QUALIFIED',
        convertedCustomerId: null,
      });
      const updated = { id: 'lead-1' };
      prisma.lead.update.mockResolvedValue(updated);
      const socialLinks: SocialLinkDto[] = [
        { platform: 'LINKEDIN', url: 'https://linkedin.com/company/padaria' },
      ];

      await service.update(
        'org-1',
        'lead-1',
        { whatsapp: '+5511900000000', contactName: 'Maria Silva', socialLinks },
        'user-1',
      );

      expect(prisma.lead.update).toHaveBeenCalledWith({
        where: { id: 'lead-1' },
        data: { whatsapp: '+5511900000000', contactName: 'Maria Silva', socialLinks },
      });
    });
  });

  describe('list', () => {
    it('aplica todos os filtros quando informados', async () => {
      prisma.lead.findMany.mockResolvedValue([]);

      await service.list('org-1', {
        status: 'QUALIFIED',
        sourceType: 'APIFY_GOOGLE_MAPS',
        minScore: 50,
        city: 'São Paulo',
        state: 'SP',
        hasWebsite: false,
        search: 'padaria',
      });

      expect(prisma.lead.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: 'org-1',
          status: 'QUALIFIED',
          sourceType: 'APIFY_GOOGLE_MAPS',
          score: { gte: 50 },
          city: { equals: 'São Paulo', mode: 'insensitive' },
          state: { equals: 'SP', mode: 'insensitive' },
          website: null,
          OR: [
            { name: { contains: 'padaria', mode: 'insensitive' } },
            { rawContent: { contains: 'padaria', mode: 'insensitive' } },
          ],
        },
        orderBy: { discoveredAt: 'desc' },
      });
    });

    it('filtra por scrapeJobId quando informado (lista de leads de uma busca específica)', async () => {
      prisma.lead.findMany.mockResolvedValue([]);

      await service.list('org-1', { scrapeJobId: 'job-1' });

      expect(prisma.lead.findMany).toHaveBeenCalledWith({
        where: { organizationId: 'org-1', scrapeJobId: 'job-1' },
        orderBy: { discoveredAt: 'desc' },
      });
    });

    it('hasContactMethod: true gera OR de phone/email/whatsapp/socialLinks quando sozinho', async () => {
      prisma.lead.findMany.mockResolvedValue([]);

      await service.list('org-1', { hasContactMethod: true });

      expect(prisma.lead.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: 'org-1',
          OR: [
            { phone: { not: null } },
            { email: { not: null } },
            { whatsapp: { not: null } },
            { socialLinks: { not: Prisma.DbNull } },
          ],
        },
        orderBy: { discoveredAt: 'desc' },
      });
    });

    it('combina hasContactMethod com search via AND, sem colisão de chave OR', async () => {
      prisma.lead.findMany.mockResolvedValue([]);

      await service.list('org-1', { hasContactMethod: true, search: 'padaria' });

      expect(prisma.lead.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: 'org-1',
          AND: [
            {
              OR: [
                { name: { contains: 'padaria', mode: 'insensitive' } },
                { rawContent: { contains: 'padaria', mode: 'insensitive' } },
              ],
            },
            {
              OR: [
                { phone: { not: null } },
                { email: { not: null } },
                { whatsapp: { not: null } },
                { socialLinks: { not: Prisma.DbNull } },
              ],
            },
          ],
        },
        orderBy: { discoveredAt: 'desc' },
      });
    });

    it('hasContactMethod ausente não adiciona cláusula de contato nenhuma', async () => {
      prisma.lead.findMany.mockResolvedValue([]);

      await service.list('org-1', {});

      expect(prisma.lead.findMany).toHaveBeenCalledWith({
        where: { organizationId: 'org-1' },
        orderBy: { discoveredAt: 'desc' },
      });
    });

    it('hasContactMethod: false filtra leads SEM nenhum contato (AND de nulos), nunca devolve todos', async () => {
      prisma.lead.findMany.mockResolvedValue([]);

      await service.list('org-1', { hasContactMethod: false });

      expect(prisma.lead.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: 'org-1',
          phone: null,
          email: null,
          whatsapp: null,
          socialLinks: { equals: Prisma.DbNull },
        },
        orderBy: { discoveredAt: 'desc' },
      });
    });

    it('hasContactMethod: false combina com search sem colidir com o OR de busca', async () => {
      prisma.lead.findMany.mockResolvedValue([]);

      await service.list('org-1', { hasContactMethod: false, search: 'padaria' });

      expect(prisma.lead.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: 'org-1',
          phone: null,
          email: null,
          whatsapp: null,
          socialLinks: { equals: Prisma.DbNull },
          OR: [
            { name: { contains: 'padaria', mode: 'insensitive' } },
            { rawContent: { contains: 'padaria', mode: 'insensitive' } },
          ],
        },
        orderBy: { discoveredAt: 'desc' },
      });
    });
  });

  describe('score', () => {
    it('calcula score sem firmographics (fallback de rawContent) e marca DISQUALIFIED abaixo do threshold', async () => {
      prisma.lead.findFirst.mockResolvedValue({
        id: 'lead-1',
        organizationId: 'org-1',
        status: 'DISCOVERED',
        website: 'https://acme.com',
        googleCategory: null,
        rating: null,
        reviewCount: null,
        rawContent: null,
        enrichments: [],
        outreachMessages: [],
      });
      prisma.serviceOffering.findMany.mockResolvedValue([]);
      prisma.leadEnrichment.findFirst.mockResolvedValue(null);
      prisma.lead.update.mockResolvedValue({ id: 'lead-1', score: 0, status: 'DISQUALIFIED' });

      const result = await service.score('org-1', 'lead-1', 'user-1');

      expect(prisma.lead.update).toHaveBeenCalledWith({
        where: { id: 'lead-1' },
        data: {
          score: 0,
          scoreBreakdown: expect.objectContaining({ total: 0 }),
          status: 'DISQUALIFIED',
          suggestedOfferingId: null,
        },
      });
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'lead.scored', resource: 'Lead:lead-1' }),
      );
      expect(result.status).toBe('DISQUALIFIED');
    });

    it('usa firmographics do LeadEnrichment mais recente quando existe', async () => {
      prisma.lead.findFirst.mockResolvedValue({
        id: 'lead-1',
        organizationId: 'org-1',
        status: 'DISCOVERED',
        website: null,
        googleCategory: null,
        rating: null,
        reviewCount: null,
        rawContent: null,
      });
      prisma.serviceOffering.findMany.mockResolvedValue([
        {
          id: 'off-1',
          signals: [],
          targetIndustries: ['tecnologia'],
          minEmployees: null,
          maxEmployees: null,
          minRevenueUsd: null,
          maxRevenueUsd: null,
        },
      ]);
      prisma.leadEnrichment.findFirst.mockResolvedValue({
        data: { industry: 'tecnologia', employeeCount: 20, revenueUsd: 500_000 },
      });
      prisma.lead.update.mockImplementation(({ data }) => Promise.resolve({ id: 'lead-1', ...data }));

      const result = await service.score('org-1', 'lead-1', 'user-1');

      // hasNoWebsitePoints(50) + icpFit (industry/employee/revenue todos
      // batem, já que a offering não define bounds) = 80 >= threshold(50)
      expect(result.status).toBe('QUALIFIED');
      expect(result.suggestedOfferingId).toBe('off-1');
    });

    it('nunca regride status de um lead que já avançou além da qualificação (ex.: CONVERTED)', async () => {
      prisma.lead.findFirst.mockResolvedValue({
        id: 'lead-1',
        organizationId: 'org-1',
        status: 'CONVERTED',
        convertedCustomerId: 'cust-1',
        website: null, // pontuaria QUALIFIED se status fosse escrito
        googleCategory: null,
        rating: null,
        reviewCount: null,
        rawContent: null,
      });
      prisma.serviceOffering.findMany.mockResolvedValue([]);
      prisma.leadEnrichment.findFirst.mockResolvedValue(null);
      prisma.lead.update.mockImplementation(({ data }) => Promise.resolve({ id: 'lead-1', ...data }));

      await service.score('org-1', 'lead-1', 'user-1');

      // `status` nunca entra no `data` do update — CONVERTED não está em
      // PRE_QUALIFICATION_STATUSES, então não é sobrescrito mesmo com um
      // score que teoricamente qualificaria o lead.
      expect(prisma.lead.update).toHaveBeenCalledWith({
        where: { id: 'lead-1' },
        data: {
          score: expect.any(Number),
          scoreBreakdown: expect.any(Object),
          suggestedOfferingId: null,
        },
      });
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: { score: expect.any(Number), status: 'CONVERTED' } }),
      );
    });
  });

  describe('enrich', () => {
    it('grava LeadEnrichment quando a Explorium encontra um match e recalcula o score', async () => {
      const lead = {
        id: 'lead-1',
        organizationId: 'org-1',
        status: 'DISCOVERED',
        name: 'Padaria Central',
        address: 'Rua X',
        website: null,
        googleCategory: null,
        rating: null,
        reviewCount: null,
        rawContent: null,
      };
      prisma.lead.findFirst.mockResolvedValue(lead);
      exploriumGateway.matchBusiness.mockResolvedValue({
        industry: 'alimentação',
        employeeCount: 5,
        revenueUsd: 100_000,
      });
      prisma.serviceOffering.findMany.mockResolvedValue([]);
      prisma.leadEnrichment.findFirst.mockResolvedValue({
        data: { industry: 'alimentação', employeeCount: 5, revenueUsd: 100_000 },
      });
      prisma.lead.update.mockImplementation(({ data }) => Promise.resolve({ id: 'lead-1', ...data }));

      await service.enrich('org-1', 'lead-1', 'user-1');

      expect(exploriumGateway.matchBusiness).toHaveBeenCalledWith('Padaria Central', 'Rua X', null);
      expect(prisma.leadEnrichment.create).toHaveBeenCalledWith({
        data: {
          organizationId: 'org-1',
          leadId: 'lead-1',
          type: 'explorium_firmographics',
          data: { industry: 'alimentação', employeeCount: 5, revenueUsd: 100_000 },
          actorType: 'USER',
          actorId: 'user-1',
        },
      });
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'lead.enriched', metadata: { matched: true } }),
      );
    });

    it('não grava enrichment quando a Explorium não encontra nenhum match, mas ainda recalcula score', async () => {
      prisma.lead.findFirst.mockResolvedValue({
        id: 'lead-1',
        organizationId: 'org-1',
        status: 'DISCOVERED',
        name: 'Padaria Central',
        address: null,
        website: null,
        googleCategory: null,
        rating: null,
        reviewCount: null,
        rawContent: null,
      });
      exploriumGateway.matchBusiness.mockResolvedValue(null);
      prisma.serviceOffering.findMany.mockResolvedValue([]);
      prisma.leadEnrichment.findFirst.mockResolvedValue(null);
      prisma.lead.update.mockResolvedValue({ id: 'lead-1' });

      await service.enrich('org-1', 'lead-1', 'user-1');

      expect(prisma.leadEnrichment.create).not.toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'lead.enriched', metadata: { matched: false } }),
      );
    });
  });

  describe('convertToCustomer', () => {
    it('cria o Customer, marca o Lead CONVERTED e audita', async () => {
      prisma.lead.findFirst.mockResolvedValue({
        id: 'lead-1',
        organizationId: 'org-1',
        name: 'Padaria Central',
        phone: '111',
        email: 'a@a.com',
        convertedCustomerId: null,
      });
      const customer = { id: 'cust-1', name: 'Padaria Central' };
      prisma.customer.create.mockResolvedValue(customer);
      prisma.lead.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.convertToCustomer('org-1', 'lead-1', {}, 'user-1');

      expect(prisma.customer.create).toHaveBeenCalledWith({
        data: {
          organizationId: 'org-1',
          name: 'Padaria Central',
          company: 'Padaria Central',
          phone: '111',
          email: 'a@a.com',
          status: 'LEAD',
        },
      });
      expect(prisma.lead.updateMany).toHaveBeenCalledWith({
        where: { id: 'lead-1', organizationId: 'org-1', convertedCustomerId: null },
        data: { status: 'CONVERTED', convertedCustomerId: 'cust-1' },
      });
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'lead.converted', metadata: { customerId: 'cust-1' } }),
      );
      expect(result).toBe(customer);
    });

    it('cria um Deal em QUALIFICATION vinculado ao Lead de origem (ponte achar -> fechar)', async () => {
      prisma.lead.findFirst.mockResolvedValue({
        id: 'lead-1',
        organizationId: 'org-1',
        name: 'Padaria Central',
        phone: '111',
        email: 'a@a.com',
        convertedCustomerId: null,
      });
      prisma.customer.create.mockResolvedValue({ id: 'cust-1', name: 'Padaria Central' });
      prisma.lead.updateMany.mockResolvedValue({ count: 1 });

      await service.convertToCustomer('org-1', 'lead-1', {}, 'user-1');

      expect(dealsService.create).toHaveBeenCalledWith(
        'org-1',
        expect.objectContaining({ customerId: 'cust-1', title: 'Padaria Central', value: 0 }),
        'user-1',
        { originLeadId: 'lead-1' },
      );
    });

    it('lança 409 quando o lead já tem convertedCustomerId (fast path)', async () => {
      prisma.lead.findFirst.mockResolvedValue({
        id: 'lead-1',
        organizationId: 'org-1',
        convertedCustomerId: 'cust-existing',
      });

      await expect(service.convertToCustomer('org-1', 'lead-1', {}, 'user-1')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.customer.create).not.toHaveBeenCalled();
    });

    it('lança 409 quando perde a corrida de conversão concorrente (updateMany count 0)', async () => {
      prisma.lead.findFirst.mockResolvedValue({
        id: 'lead-1',
        organizationId: 'org-1',
        name: 'Padaria Central',
        phone: null,
        email: null,
        convertedCustomerId: null,
      });
      prisma.customer.create.mockResolvedValue({ id: 'cust-1' });
      prisma.lead.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.convertToCustomer('org-1', 'lead-1', {}, 'user-1')).rejects.toThrow(
        ConflictException,
      );
      expect(auditService.log).not.toHaveBeenCalled();
    });
  });

  describe('autoAssign', () => {
    it('atribui ao membro (WRITE_ROLES) com menos leads em aberto', async () => {
      prisma.lead.findFirst.mockResolvedValue({ id: 'lead-1', organizationId: 'org-1', status: 'DISCOVERED' });
      prisma.membership.findMany.mockResolvedValue([
        { userId: 'user-a' },
        { userId: 'user-b' },
      ]);
      prisma.lead.groupBy.mockResolvedValue([
        { assignedUserId: 'user-a', _count: { _all: 5 } },
        { assignedUserId: 'user-b', _count: { _all: 1 } },
      ]);
      prisma.lead.update.mockResolvedValue({ id: 'lead-1', assignedUserId: 'user-b' });

      const result = await service.autoAssign('org-1', 'lead-1');

      expect(prisma.membership.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organizationId: 'org-1', role: { in: ['OWNER', 'ADMIN', 'MANAGER', 'MEMBER'] } } }),
      );
      expect(prisma.lead.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: 'org-1',
            status: { notIn: ['CONVERTED', 'LOST'] },
          }),
        }),
      );
      expect(prisma.lead.update).toHaveBeenCalledWith({
        where: { id: 'lead-1' },
        data: { assignedUserId: 'user-b' },
      });
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ actorType: 'SYSTEM', action: 'lead.auto_assigned', resource: 'Lead:lead-1' }),
      );
      expect(result.assignedUserId).toBe('user-b');
    });

    it('sem nenhum membro elegível na organização, devolve o lead sem atribuir (nunca lança erro)', async () => {
      prisma.lead.findFirst.mockResolvedValue({ id: 'lead-1', organizationId: 'org-1', status: 'DISCOVERED' });
      prisma.membership.findMany.mockResolvedValue([]);

      const result = await service.autoAssign('org-1', 'lead-1');

      expect(prisma.lead.update).not.toHaveBeenCalled();
      expect(result.assignedUserId).toBeUndefined();
    });
  });

  describe('assign', () => {
    it('atribui manualmente a um membro específico da organização e audita como ação humana', async () => {
      prisma.lead.findFirst.mockResolvedValue({ id: 'lead-1', organizationId: 'org-1' });
      prisma.membership.findFirst.mockResolvedValue({ id: 'mem-1', userId: 'user-b', organizationId: 'org-1' });
      prisma.lead.update.mockResolvedValue({ id: 'lead-1', assignedUserId: 'user-b' });

      const result = await service.assign('org-1', 'lead-1', 'user-b', 'user-1');

      expect(prisma.lead.update).toHaveBeenCalledWith({
        where: { id: 'lead-1' },
        data: { assignedUserId: 'user-b' },
      });
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ actorType: 'USER', actorId: 'user-1', action: 'lead.assigned', resource: 'Lead:lead-1' }),
      );
      expect(result.assignedUserId).toBe('user-b');
    });

    it('rejeita quando o usuário indicado não é membro desta organização', async () => {
      prisma.lead.findFirst.mockResolvedValue({ id: 'lead-1', organizationId: 'org-1' });
      prisma.membership.findFirst.mockResolvedValue(null);

      await expect(service.assign('org-1', 'lead-1', 'user-de-outra-org', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.lead.update).not.toHaveBeenCalled();
    });
  });
});
