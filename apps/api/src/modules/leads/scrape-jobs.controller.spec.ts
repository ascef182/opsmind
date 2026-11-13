import { ScrapeJobsController } from './scrape-jobs.controller';

describe('ScrapeJobsController', () => {
  it('create: repassa organizationId, userId e dto para o service', async () => {
    const service = {
      create: jest.fn().mockResolvedValue({ id: 'job-1' }),
      createBatch: jest.fn(),
      list: jest.fn(),
      findByIdOrThrow: jest.fn(),
    };
    const controller = new ScrapeJobsController(service as never);
    const dto = { sourceType: 'APIFY_GOOGLE_MAPS', city: 'São Paulo', state: 'SP', businessType: 'padaria' };

    const result = await controller.create('org-1', { id: 'user-1' } as never, dto as never);

    expect(result).toEqual({ id: 'job-1' });
    expect(service.create).toHaveBeenCalledWith('org-1', dto, 'user-1');
  });

  it('createBatch: repassa organizationId, userId e dto para o service', async () => {
    const service = {
      create: jest.fn(),
      createBatch: jest.fn().mockResolvedValue({ created: [{ id: 'job-1' }], skipped: [] }),
      list: jest.fn(),
      findByIdOrThrow: jest.fn(),
    };
    const controller = new ScrapeJobsController(service as never);
    const dto = {
      sourceType: 'APIFY_GOOGLE_MAPS',
      businessType: 'padaria',
      locations: [{ city: 'São Paulo', state: 'SP' }],
    };

    const result = await controller.createBatch('org-1', { id: 'user-1' } as never, dto as never);

    expect(result).toEqual({ created: [{ id: 'job-1' }], skipped: [] });
    expect(service.createBatch).toHaveBeenCalledWith('org-1', dto, 'user-1');
  });

  it('list: repassa organizationId e query para o service', async () => {
    const service = { create: jest.fn(), createBatch: jest.fn(), list: jest.fn().mockResolvedValue([]), findByIdOrThrow: jest.fn() };
    const controller = new ScrapeJobsController(service as never);

    await controller.list('org-1', { status: 'COMPLETED' } as never);

    expect(service.list).toHaveBeenCalledWith('org-1', { status: 'COMPLETED' });
  });

  it('findOne: repassa organizationId e scrapeJobId para o service', async () => {
    const service = {
      create: jest.fn(),
      createBatch: jest.fn(),
      list: jest.fn(),
      findByIdOrThrow: jest.fn().mockResolvedValue({ id: 'job-1' }),
    };
    const controller = new ScrapeJobsController(service as never);

    const result = await controller.findOne('org-1', 'job-1');

    expect(result).toEqual({ id: 'job-1' });
    expect(service.findByIdOrThrow).toHaveBeenCalledWith('org-1', 'job-1');
  });
});
