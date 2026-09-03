import { NotFoundException } from '@nestjs/common';
import { ScrapeJobsService } from './scrape-jobs.service';

describe('ScrapeJobsService', () => {
  let service: ScrapeJobsService;
  let prisma: { scrapeJob: { create: jest.Mock; findFirst: jest.Mock; findMany: jest.Mock } };
  let auditService: { log: jest.Mock };
  let queueService: { enqueue: jest.Mock };

  beforeEach(() => {
    prisma = { scrapeJob: { create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn() } };
    auditService = { log: jest.fn() };
    queueService = { enqueue: jest.fn() };
    service = new ScrapeJobsService(prisma as never, auditService as never, queueService as never);
  });

  describe('create', () => {
    it('cria o ScrapeJob QUEUED, enfileira e audita', async () => {
      const created = { id: 'job-1', organizationId: 'org-1', status: 'QUEUED' };
      prisma.scrapeJob.create.mockResolvedValue(created);

      const dto = {
        sourceType: 'APIFY_GOOGLE_MAPS' as const,
        city: 'São Paulo',
        state: 'SP',
        businessType: 'padaria',
      };
      const result = await service.create('org-1', dto, 'user-1');

      expect(prisma.scrapeJob.create).toHaveBeenCalledWith({
        data: {
          organizationId: 'org-1',
          sourceType: 'APIFY_GOOGLE_MAPS',
          city: 'São Paulo',
          state: 'SP',
          businessType: 'padaria',
          onlyWithoutWebsite: true,
          status: 'QUEUED',
          actorType: 'USER',
          actorId: 'user-1',
        },
      });
      expect(queueService.enqueue).toHaveBeenCalledWith({
        organizationId: 'org-1',
        scrapeJobId: 'job-1',
        actorType: 'USER',
        actorId: 'user-1',
      });
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'scrape_job.created', resource: 'ScrapeJob:job-1' }),
      );
      expect(result).toBe(created);
    });

    it('respeita onlyWithoutWebsite/limit explícitos', async () => {
      prisma.scrapeJob.create.mockResolvedValue({ id: 'job-2' });

      await service.create(
        'org-1',
        {
          sourceType: 'EXPLORIUM_BUSINESS_SEARCH' as const,
          city: 'Rio',
          state: 'RJ',
          businessType: 'oficina',
          onlyWithoutWebsite: false,
          limit: 10,
        },
        'user-1',
      );

      expect(prisma.scrapeJob.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ onlyWithoutWebsite: false, limit: 10 }),
      });
    });
  });

  describe('findByIdOrThrow', () => {
    it('lança 404 quando o job não existe/não pertence à org', async () => {
      prisma.scrapeJob.findFirst.mockResolvedValue(null);

      await expect(service.findByIdOrThrow('org-1', 'missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('list', () => {
    it('filtra por status quando informado', async () => {
      prisma.scrapeJob.findMany.mockResolvedValue([]);

      await service.list('org-1', { status: 'COMPLETED' });

      expect(prisma.scrapeJob.findMany).toHaveBeenCalledWith({
        where: { organizationId: 'org-1', status: 'COMPLETED' },
        orderBy: { createdAt: 'desc' },
      });
    });
  });
});
