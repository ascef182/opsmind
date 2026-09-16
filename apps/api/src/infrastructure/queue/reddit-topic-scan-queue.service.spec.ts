jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: jest.fn().mockResolvedValue({ id: 'job-1' }),
    close: jest.fn().mockResolvedValue(undefined),
  })),
}));
jest.mock('ioredis', () => jest.fn().mockImplementation(() => ({ disconnect: jest.fn() })));

import { Queue } from 'bullmq';
import { RedditTopicScanQueueService } from './reddit-topic-scan-queue.service';

describe('RedditTopicScanQueueService', () => {
  it('enfileira o job na fila reddit-topic-scan com o payload recebido', async () => {
    const configService = { get: jest.fn().mockReturnValue('redis://localhost:6379') };
    const service = new RedditTopicScanQueueService(configService as never);
    const data = { organizationId: 'org-1', topicId: 'topic-1' };

    await service.enqueue(data);

    const queueInstance = (Queue as unknown as jest.Mock).mock.results[0]!.value;
    expect(Queue).toHaveBeenCalledWith('reddit-topic-scan', expect.anything());
    expect(queueInstance.add).toHaveBeenCalledWith('scan', data);
  });
});
