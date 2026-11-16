jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: jest.fn().mockResolvedValue({ id: 'job-1' }),
    close: jest.fn().mockResolvedValue(undefined),
  })),
}));
jest.mock('ioredis', () => jest.fn().mockImplementation(() => ({ disconnect: jest.fn() })));

import { Queue } from 'bullmq';
import { OutreachAutodraftQueueService } from './outreach-autodraft-queue.service';

describe('OutreachAutodraftQueueService', () => {
  it('enfileira o job na fila outreach-autodraft com o nome draft e o payload recebido', async () => {
    const configService = { get: jest.fn().mockReturnValue('redis://localhost:6379') };
    const service = new OutreachAutodraftQueueService(configService as never);
    const data = {
      organizationId: 'org1',
      leadId: 'lead1',
      channel: 'EMAIL' as const,
      serviceOfferingId: 'off1',
    };

    await service.enqueue(data);

    const queueInstance = (Queue as unknown as jest.Mock).mock.results[0]!.value;
    expect(Queue).toHaveBeenCalledWith('outreach-autodraft', expect.anything());
    expect(queueInstance.add).toHaveBeenCalledWith('draft', data);
  });
});
