jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: jest.fn().mockResolvedValue({ id: 'job-1' }),
    close: jest.fn().mockResolvedValue(undefined),
  })),
}));
jest.mock('ioredis', () => jest.fn().mockImplementation(() => ({ disconnect: jest.fn() })));

import { Queue } from 'bullmq';
import { LeadScrapeQueueService } from './lead-scrape-queue.service';

describe('LeadScrapeQueueService', () => {
  it('enfileira o job na fila lead-scrape com o payload recebido', async () => {
    const configService = { get: jest.fn().mockReturnValue('redis://localhost:6379') };
    const service = new LeadScrapeQueueService(configService as never);
    const data = {
      organizationId: 'org-1',
      scrapeJobId: 'scrape-1',
      actorType: 'USER' as const,
      actorId: 'user-1',
    };

    await service.enqueue(data);

    const queueInstance = (Queue as unknown as jest.Mock).mock.results[0]!.value;
    expect(Queue).toHaveBeenCalledWith('lead-scrape', expect.anything());
    expect(queueInstance.add).toHaveBeenCalledWith('scrape', data);
  });
});
