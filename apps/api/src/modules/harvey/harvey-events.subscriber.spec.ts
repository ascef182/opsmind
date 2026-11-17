import type { MessageEvent } from '@nestjs/common';
import { take, toArray, firstValueFrom } from 'rxjs';
import { HARVEY_KEEPALIVE_MS, HarveyEventsSubscriber } from './harvey-events.subscriber';

jest.mock('ioredis', () =>
  jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    psubscribe: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn(),
  })),
);

const config = { get: () => 'redis://localhost:6379' };
const activity = (id: string, organizationId: string) => ({
  kind: 'activity',
  activity: { id, organizationId, title: 't' },
});

describe('HarveyEventsSubscriber', () => {
  it('stream only delivers own org', async () => {
    const subscriber = new HarveyEventsSubscriber(config as never);
    const received = firstValueFrom(subscriber.stream('org-a').pipe(take(1), toArray()));
    subscriber.handle('harvey:org:org-b', JSON.stringify(activity('b-1', 'org-b')));
    subscriber.handle('harvey:org:org-a', JSON.stringify(activity('a-1', 'org-a')));
    const [event] = (await received) as MessageEvent[];
    expect(event).toMatchObject({ id: 'a-1', type: 'activity' });
    subscriber.onModuleDestroy();
  });

  it('ignores channels outside the Harvey namespace and malformed payloads', async () => {
    const subscriber = new HarveyEventsSubscriber(config as never);
    const received = firstValueFrom(subscriber.stream('org-a').pipe(take(1), toArray()));
    subscriber.handle('other:org-a', JSON.stringify(activity('x', 'org-a')));
    subscriber.handle('harvey:org:org-a', '{not json');
    subscriber.handle('harvey:org:org-a', JSON.stringify({ kind: 'status.changed' }));
    expect(await received).toEqual([{ type: 'status.changed', data: { kind: 'status.changed' } }]);
    subscriber.onModuleDestroy();
  });

  it('emits keep-alive every 25s', async () => {
    jest.useFakeTimers();
    const subscriber = new HarveyEventsSubscriber(config as never);
    const events: MessageEvent[] = [];
    const sub = subscriber.stream('org-a').subscribe((event) => events.push(event));
    jest.advanceTimersByTime(HARVEY_KEEPALIVE_MS);
    expect(HARVEY_KEEPALIVE_MS).toBe(25_000);
    expect(events).toEqual([{ type: 'ping', data: '' }]);
    sub.unsubscribe();
    subscriber.onModuleDestroy();
    jest.useRealTimers();
  });
});
