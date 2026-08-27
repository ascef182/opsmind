jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: jest.fn().mockResolvedValue({ id: 'job-1' }),
    close: jest.fn().mockResolvedValue(undefined),
  })),
}));
jest.mock('ioredis', () => jest.fn().mockImplementation(() => ({ disconnect: jest.fn() })));

import { Queue } from 'bullmq';
import { AutomationQueueService } from './automation-queue.service';

describe('AutomationQueueService', () => {
  it('enfileira o job na fila automation-execution com o payload recebido', async () => {
    const configService = { get: jest.fn().mockReturnValue('redis://localhost:6379') };
    const service = new AutomationQueueService(configService as never);
    const data = {
      organizationId: 'org-1',
      automationId: 'auto-1',
      customerId: 'cust-1',
      actorType: 'SYSTEM' as const,
    };

    await service.enqueue(data);

    const queueInstance = (Queue as unknown as jest.Mock).mock.results[0]!.value;
    expect(Queue).toHaveBeenCalledWith('automation-execution', expect.anything());
    expect(queueInstance.add).toHaveBeenCalledWith('execute', data);
  });
});
