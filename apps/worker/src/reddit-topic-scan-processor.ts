import type { PrismaClient } from '@opsmind/database';
import type { CamofoxGateway } from '@opsmind/integrations';
import type { RedditClusteringJobData, RedditTopicScanJobData } from '@opsmind/shared-types';
import type Redis from 'ioredis';
import { scanOneRedditWatchTopic } from './reddit-mining-scan';

/**
 * Consumidor de `reddit-topic-scan` (E5, "Verificar agora" da UI) —
 * espelha `processLeadScrapeJob` em estrutura mínima: busca o tópico e
 * delega pra `scanOneRedditWatchTopic` (mesma função que o sweep periódico
 * em `reddit-mining-scan.ts` usa, sem duplicar orçamento/busca/registro de
 * status).
 */
export async function processRedditTopicScanJob(
  prisma: PrismaClient,
  camofox: CamofoxGateway,
  redis: Redis,
  data: RedditTopicScanJobData,
  enqueueClusteringJob: (data: RedditClusteringJobData) => Promise<unknown>,
): Promise<void> {
  const topic = await prisma.redditWatchTopic.findUnique({
    where: { id: data.topicId },
    include: { organization: true },
  });
  // Removido entre o enfileiramento (clique em "Verificar agora") e o
  // processamento — nada a fazer, não é um erro.
  if (!topic) return;

  await scanOneRedditWatchTopic(prisma, topic, camofox, redis, enqueueClusteringJob);
}
