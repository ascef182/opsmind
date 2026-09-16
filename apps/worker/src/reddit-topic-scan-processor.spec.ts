jest.mock('./reddit-mining-scan', () => ({
  scanOneRedditWatchTopic: jest.fn(),
}));

import { processRedditTopicScanJob } from './reddit-topic-scan-processor';
import { scanOneRedditWatchTopic } from './reddit-mining-scan';

describe('processRedditTopicScanJob', () => {
  function buildPrisma() {
    return { redditWatchTopic: { findUnique: jest.fn() } };
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('busca o tópico por id (com organization) e delega o scan pra scanOneRedditWatchTopic', async () => {
    const prisma = buildPrisma();
    const topic = { id: 'topic-1', organizationId: 'org-1', organization: { scrapingMonthlyBudget: null } };
    prisma.redditWatchTopic.findUnique.mockResolvedValue(topic);
    const camofox = {};
    const redis = {};
    const enqueue = jest.fn();

    await processRedditTopicScanJob(
      prisma as never,
      camofox as never,
      redis as never,
      { organizationId: 'org-1', topicId: 'topic-1' },
      enqueue,
    );

    expect(prisma.redditWatchTopic.findUnique).toHaveBeenCalledWith({
      where: { id: 'topic-1' },
      include: { organization: true },
    });
    expect(scanOneRedditWatchTopic).toHaveBeenCalledWith(prisma, topic, camofox, redis, enqueue);
  });

  it('não lança e não escaneia nada quando o tópico foi removido antes do processamento', async () => {
    const prisma = buildPrisma();
    prisma.redditWatchTopic.findUnique.mockResolvedValue(null);

    await expect(
      processRedditTopicScanJob(
        prisma as never,
        {} as never,
        {} as never,
        { organizationId: 'org-1', topicId: 'missing' },
        jest.fn(),
      ),
    ).resolves.toBeUndefined();
    expect(scanOneRedditWatchTopic).not.toHaveBeenCalled();
  });
});
