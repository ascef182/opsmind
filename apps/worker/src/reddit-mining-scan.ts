import type { PrismaClient } from '@opsmind/database';
import type { CamofoxGateway } from '@opsmind/integrations';
import type { RedditClusteringJobData } from '@opsmind/shared-types';
import * as Sentry from '@sentry/node';

/**
 * Quantos posts candidatos buscar por `RedditWatchTopic` a cada tick do scan
 * — mesmo valor fixo usado em toda esta feature pra uma única chamada de
 * busca (`CamofoxSearchParams.limit`), não configurável por organização.
 */
const REDDIT_MINING_SEARCH_LIMIT = 25;

/**
 * Trigger (Task 13, mineração de oportunidades de mercado no Reddit) — roda
 * periodicamente (ver main.ts), espelhando `scanProspectingTargets`
 * (`prospecting-scan.ts`, Task 7): acha `RedditWatchTopic`s ativos de todas
 * as organizações e, para cada um, busca posts candidatos via Camoufox
 * (`@reddit_search`), enfileirando um job em `REDDIT_CLUSTERING_QUEUE`
 * (`reddit-clustering-queue.ts`) quando a busca devolve pelo menos um
 * resultado. O clustering em si (agrupar por tema/comunidade via IA) é
 * trabalho do consumer do outro lado da fila (`apps/api`,
 * `reddit-clustering.consumer.ts`, Task 12) — este scan só descobre e
 * enfileira posts candidatos, nunca chama IA diretamente.
 *
 * Try/catch por tópico (mesmo espírito do try/catch por target de
 * `scanProspectingTargets`): uma falha isolada (erro de rede do Camoufox,
 * resposta malformada) nunca deve abortar o resto do scan — os outros
 * tópicos, de outras organizações inclusive, precisam continuar sendo
 * processados.
 */
export async function scanRedditMiningTopics(
  prisma: PrismaClient,
  camofox: CamofoxGateway,
  // Retorno intencionalmente `unknown` — mesmo racional do `enqueue` de
  // `scanProspectingTargets`: o chamador real (main.ts) passa
  // `queue.add(...)`, e o scan não precisa (nem deve) inspecionar o retorno.
  enqueueClusteringJob: (data: RedditClusteringJobData) => Promise<unknown>,
): Promise<number> {
  const topics = await prisma.redditWatchTopic.findMany({
    where: { isActive: true },
  });

  let enqueuedCount = 0;

  for (const topic of topics) {
    try {
      const query = topic.subreddit ? `subreddit:${topic.subreddit} ${topic.query}` : topic.query;

      const results = await camofox.search({
        macro: '@reddit_search',
        query,
        limit: REDDIT_MINING_SEARCH_LIMIT,
      });

      if (results.length === 0) {
        // Resultado vazio é esperado (não é erro): `@reddit_search` via
        // Camoufox é uma fonte não verificada (ver ressalvas no comentário
        // de topo de `CamofoxGatewayService`) — um tópico sem posts
        // candidatos neste tick simplesmente não gera job, e o scan segue
        // pros próximos tópicos.
        // eslint-disable-next-line no-console -- visibilidade mínima mesmo sem SENTRY_DSN configurado
        console.debug(
          `[reddit-mining-scan] busca sem resultados para o tópico ${topic.id} (org ${topic.organizationId}) — pulando.`,
        );
        continue;
      }

      await enqueueClusteringJob({
        organizationId: topic.organizationId,
        topicId: topic.id,
        topicQuery: topic.query,
        candidatePosts: results.map((result) => ({
          url: result.url,
          title: result.title,
          textContent: result.textContent,
        })),
      });

      enqueuedCount += 1;
    } catch (error) {
      Sentry.captureException(error, {
        extra: { redditWatchTopicId: topic.id, organizationId: topic.organizationId },
      });
      // eslint-disable-next-line no-console -- visibilidade mínima mesmo sem SENTRY_DSN configurado (SDK vira no-op nesse caso)
      console.error(
        `[reddit-mining-scan] falha ao buscar/enfileirar posts candidatos do tópico ${topic.id} (org ${topic.organizationId}):`,
        error,
      );
    }
  }

  return enqueuedCount;
}
