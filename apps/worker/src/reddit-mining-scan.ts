import type { PrismaClient, Prisma } from '@opsmind/database';
import type { CamofoxGateway } from '@opsmind/integrations';
import { isSafeHttpUrl, type RedditClusteringJobData } from '@opsmind/shared-types';
import type Redis from 'ioredis';
import * as Sentry from '@sentry/node';
import { isOverBudget, recordSpend } from './budget';

export type RedditWatchTopicForScan = Prisma.RedditWatchTopicGetPayload<{ include: { organization: true } }>;

/**
 * Quantos posts candidatos buscar por `RedditWatchTopic` a cada tick do scan
 * — mesmo valor fixo usado em toda esta feature pra uma única chamada de
 * busca (`CamofoxSearchParams.limit`), não configurável por organização.
 */
const REDDIT_MINING_SEARCH_LIMIT = 25;

/**
 * Custo estimado de UMA chamada de busca do Camoufox, em USD — mesmo valor de
 * `SCRAPING_COST_PER_LEAD_USD.CAMOFOX_*` (`lead-scrape-processor.ts`),
 * duplicado aqui (e não importado) pra não puxar o processor inteiro de
 * scraping de leads só por uma constante; se aquele valor mudar, este muda
 * junto. Cobrado por CHAMADA (não por resultado): a busca custa tempo de
 * computação/proxy do navegador self-hosted mesmo quando volta vazia.
 */
const CAMOFOX_SEARCH_COST_USD = 0.001;

type RedditScanStatus = 'OK' | 'ERROR' | 'SKIPPED_BUDGET';

/**
 * Registra o resultado da tentativa (sucesso, erro, ou pulado por
 * orçamento) em `RedditWatchTopic.lastScannedAt/lastScanStatus/lastScanError`
 * — sem isso o monitoramento "não funcionar" (Camoufox mal configurado,
 * orçamento estourado) era invisível: nada no banco/UI distinguia "nunca
 * rodou" de "rodou e falhou". Best-effort: uma falha ao GRAVAR o status não
 * pode derrubar o resto do scan dos outros tópicos.
 */
async function recordScanAttempt(
  prisma: PrismaClient,
  topicId: string,
  status: RedditScanStatus,
  errorMessage: string | null,
): Promise<void> {
  try {
    await prisma.redditWatchTopic.update({
      where: { id: topicId },
      data: { lastScannedAt: new Date(), lastScanStatus: status, lastScanError: errorMessage },
    });
  } catch (error) {
    Sentry.captureException(error, { extra: { redditWatchTopicId: topicId, context: 'recordScanAttempt' } });
  }
}

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
 *
 * Assinatura recebe `redis` além de `prisma`/`camofox`/`enqueue` pelo mesmo
 * motivo de `scanProspectingTargets`: o corte de orçamento (`isOverBudget`,
 * `./budget.ts`) é uma versão framework-free apoiada em Redis. Aqui ele é
 * obrigatório — diferente do scan de prospecção, que só CRIA um `ScrapeJob`
 * (quem gasta é o processor do outro lado da fila), este scan faz ele mesmo a
 * chamada paga ao Camoufox, então precisa checar o orçamento ANTES
 * (`isOverBudget`) e registrar o gasto DEPOIS (`recordSpend`).
 */
export async function scanRedditMiningTopics(
  prisma: PrismaClient,
  camofox: CamofoxGateway,
  redis: Redis,
  // Retorno intencionalmente `unknown` — mesmo racional do `enqueue` de
  // `scanProspectingTargets`: o chamador real (main.ts) passa
  // `queue.add(...)`, e o scan não precisa (nem deve) inspecionar o retorno.
  enqueueClusteringJob: (data: RedditClusteringJobData) => Promise<unknown>,
): Promise<number> {
  const topics = await prisma.redditWatchTopic.findMany({
    where: { isActive: true },
    include: { organization: true },
  });

  let enqueuedCount = 0;
  for (const topic of topics) {
    const enqueued = await scanOneRedditWatchTopic(prisma, topic, camofox, redis, enqueueClusteringJob);
    if (enqueued) enqueuedCount += 1;
  }

  return enqueuedCount;
}

/**
 * Um único tópico — extraído de `scanRedditMiningTopics` (sweep periódico,
 * `main.ts`) pra ser reaproveitado também pelo caminho on-demand
 * (`reddit-topic-scan-processor.ts`, consumer do "Verificar agora" da UI) —
 * mesmo orçamento/busca/enfileiramento/registro de status nos dois casos,
 * sem duplicar a lógica.
 */
export async function scanOneRedditWatchTopic(
  prisma: PrismaClient,
  topic: RedditWatchTopicForScan,
  camofox: CamofoxGateway,
  redis: Redis,
  enqueueClusteringJob: (data: RedditClusteringJobData) => Promise<unknown>,
): Promise<boolean> {
  try {
    // Orçamento ANTES da chamada que gasta (Global Constraint do plano) —
    // mesmo `scrapingMonthlyBudget` que `prospecting-scan.ts`/
    // `lead-scrape-processor.ts` consultam. Estourado: o tópico é pulado
    // sem nenhuma chamada ao Camoufox e sem contar pro retorno.
    const monthlyBudget =
      topic.organization.scrapingMonthlyBudget !== null
        ? Number(topic.organization.scrapingMonthlyBudget)
        : null;
    if (await isOverBudget(redis, topic.organizationId, monthlyBudget)) {
      await recordScanAttempt(prisma, topic.id, 'SKIPPED_BUDGET', null);
      return false;
    }

    const query = topic.subreddit ? `subreddit:${topic.subreddit} ${topic.query}` : topic.query;

    const results = await camofox.search({
      macro: '@reddit_search',
      query,
      limit: REDDIT_MINING_SEARCH_LIMIT,
    });

    // A chamada aconteceu (custou tempo de computação/proxy) independente
    // de ter voltado vazia — registra o gasto aqui, antes de qualquer
    // `return`, nunca só no caminho feliz.
    await recordSpend(redis, topic.organizationId, CAMOFOX_SEARCH_COST_USD);

    // Corte de esquema na INGESTÃO: a URL de cada post raspado é ecoada
    // pela IA do clustering para `MarketOpportunity.sourceUrls`, que vira
    // `href` no frontend — nada que não seja http/https pode entrar no
    // pipeline (mesma regra de `Lead.socialLinks`, ver `isSafeHttpUrl`).
    const safeResults = results.filter((result) => isSafeHttpUrl(result.url));

    if (safeResults.length === 0) {
      // Resultado vazio é esperado (não é erro): `@reddit_search` via
      // Camoufox é uma fonte não verificada (ver ressalvas no comentário
      // de topo de `CamofoxGatewayService`) — um tópico sem posts
      // candidatos neste tick simplesmente não gera job.
      // eslint-disable-next-line no-console -- visibilidade mínima mesmo sem SENTRY_DSN configurado
      console.debug(
        `[reddit-mining-scan] busca sem resultados utilizáveis para o tópico ${topic.id} (org ${topic.organizationId}) — pulando.`,
      );
      await recordScanAttempt(prisma, topic.id, 'OK', null);
      return false;
    }

    await enqueueClusteringJob({
      organizationId: topic.organizationId,
      topicId: topic.id,
      topicQuery: topic.query,
      candidatePosts: safeResults.map((result) => ({
        url: result.url,
        title: result.title,
        textContent: result.textContent,
      })),
    });

    await recordScanAttempt(prisma, topic.id, 'OK', null);
    return true;
  } catch (error) {
    Sentry.captureException(error, {
      extra: { redditWatchTopicId: topic.id, organizationId: topic.organizationId },
    });
    // eslint-disable-next-line no-console -- visibilidade mínima mesmo sem SENTRY_DSN configurado (SDK vira no-op nesse caso)
    console.error(
      `[reddit-mining-scan] falha ao buscar/enfileirar posts candidatos do tópico ${topic.id} (org ${topic.organizationId}):`,
      error,
    );
    await recordScanAttempt(prisma, topic.id, 'ERROR', error instanceof Error ? error.message : String(error));
    return false;
  }
}
