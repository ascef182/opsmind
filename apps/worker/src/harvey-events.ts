import type Redis from 'ioredis';
import { toHarveyActivityEvent, type HarveyActivity } from '@opsmind/database';
import { harveyChannel, type HarveyStreamEvent } from '@opsmind/shared-types';

export type HarveyPublish = (organizationId: string, event: HarveyStreamEvent) => Promise<void>;

// Publica no mesmo canal que a API retransmite por SSE. Sempre depois do
// commit; falha de publicação nunca derruba o job (o banco é a fonte).
export function createHarveyPublisher(redis: Pick<Redis, 'publish'>): HarveyPublish {
  return async (organizationId, event) => {
    try {
      await redis.publish(harveyChannel(organizationId), JSON.stringify(event));
    } catch {
      // A interface recupera pelo banco ao reconectar.
    }
  };
}

export async function publishActivities(
  publish: HarveyPublish | undefined,
  activities: { activity: HarveyActivity; leadName?: string | null }[],
): Promise<void> {
  if (!publish) return;
  for (const { activity, leadName } of activities) {
    await publish(activity.organizationId, {
      kind: 'activity',
      activity: toHarveyActivityEvent(activity, leadName ?? null),
    });
  }
}

export function triggerOf(data: { trigger?: 'AUTOMATIC' | 'MANUAL'; actorType: string }): 'AUTOMATIC' | 'MANUAL' {
  return data.trigger ?? (data.actorType === 'USER' ? 'MANUAL' : 'AUTOMATIC');
}
