import { ForbiddenException } from '@nestjs/common';
import { FindLeadsTool } from './find-leads.tool';

describe('FindLeadsTool', () => {
  it('cria o scrape job e retorna {scrapeJobId, status} sem esperar o job terminar', async () => {
    const job = { id: 'job-1', status: 'QUEUED' };
    const scrapeJobsService = { create: jest.fn().mockResolvedValue(job) };
    const tool = new FindLeadsTool(scrapeJobsService as never);

    const result = await tool.execute(
      { city: 'Curitiba', state: 'PR', businessType: 'restaurante' },
      { organizationId: 'org-1', userId: 'user-1', role: 'MEMBER' },
    );

    expect(result).toEqual({ scrapeJobId: 'job-1', status: 'QUEUED' });
    expect(scrapeJobsService.create).toHaveBeenCalledWith(
      'org-1',
      {
        sourceType: 'APIFY_GOOGLE_MAPS',
        city: 'Curitiba',
        state: 'PR',
        businessType: 'restaurante',
        onlyWithoutWebsite: undefined,
        limit: undefined,
      },
      'user-1',
    );
  });

  it('repassa sourceType/onlyWithoutWebsite/limit explícitos em vez do default', async () => {
    const scrapeJobsService = { create: jest.fn().mockResolvedValue({ id: 'job-2', status: 'QUEUED' }) };
    const tool = new FindLeadsTool(scrapeJobsService as never);

    await tool.execute(
      {
        city: 'São Paulo',
        state: 'SP',
        businessType: 'oficina mecânica',
        sourceType: 'CAMOFOX_GOOGLE_SEARCH',
        onlyWithoutWebsite: false,
        limit: 50,
      },
      { organizationId: 'org-1', userId: 'user-1', role: 'OWNER' },
    );

    const [, dto] = scrapeJobsService.create.mock.calls[0];
    expect(dto).toEqual({
      sourceType: 'CAMOFOX_GOOGLE_SEARCH',
      city: 'São Paulo',
      state: 'SP',
      businessType: 'oficina mecânica',
      onlyWithoutWebsite: false,
      limit: 50,
    });
  });

  it('recusa disparar busca de leads quando o papel do usuário é VIEWER', async () => {
    const scrapeJobsService = { create: jest.fn() };
    const tool = new FindLeadsTool(scrapeJobsService as never);

    await expect(
      tool.execute(
        { city: 'Curitiba', state: 'PR', businessType: 'restaurante' },
        { organizationId: 'org-1', userId: 'user-1', role: 'VIEWER' },
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(scrapeJobsService.create).not.toHaveBeenCalled();
  });
});
