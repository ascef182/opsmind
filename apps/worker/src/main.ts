// Precisa ser o primeiro import de todo o processo (Sentry.init).
import './instrument';
import * as Sentry from '@sentry/node';
import { validateEnv, type Env } from '@opsmind/config/env/schema';
import {
  ApifyGatewayService,
  ExploriumGatewayService,
  CamofoxGatewayService,
  ContactEnrichmentGatewayService,
  type ApifyGateway,
  type ExploriumGateway,
  type CamofoxGateway,
  type ContactEnrichmentGateway,
} from '@opsmind/integrations';
import { createLogger } from './logger';
import { createPrismaClient } from './tenant-context';
import { createAutomationQueue, createAutomationWorker, createRedisConnection } from './queue';
import { createLeadScrapeQueue, createLeadScrapeWorker } from './lead-scrape-queue';
import { createOutreachAutodraftQueue } from './outreach-autodraft-queue';
import { createRedditClusteringQueue } from './reddit-clustering-queue';
import { scanCustomerInactiveAutomations } from './automation-scan';
import { scanProspectingTargets } from './prospecting-scan';
import { scanRedditMiningTopics } from './reddit-mining-scan';
import { processAutomationJob } from './automation-processor';
import { processLeadScrapeJob, type LeadScrapeGateways } from './lead-scrape-processor';

// Intervalo do scan (trigger) — curto o bastante pra ser responsivo em
// dev/demo, sem martelar o Postgres à toa em produção real. Fixo por ora;
// vira env var se algum dia precisar ser ajustado por ambiente.
const SCAN_INTERVAL_MS = 60_000;

/**
 * As três integrações de scraping são todas OPCIONAIS (ver comentário em
 * `packages/config/env/schema.ts`) — nenhuma delas é dependência do resto do
 * worker (automations continuam funcionando sem nenhuma configurada). Por
 * isso a instanciação aqui NUNCA lança quando a env var falta: cada fábrica
 * devolve, nesse caso, um gateway "stub" que implementa a mesma interface
 * mas lança um erro claro (nomeando a env var faltante) só quando um
 * `ScrapeJob` de fato tenta usá-lo — o mesmo espírito de "falha alto e claro
 * só no primeiro uso real" de `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` em
 * apps/api, nunca bloqueando o boot do processo inteiro.
 */
function createApifyGateway(env: Env): ApifyGateway {
  if (!env.APIFY_API_TOKEN) {
    return {
      searchBusinesses: async () => {
        throw new Error(
          'APIFY_API_TOKEN não configurado — scraping via Apify (APIFY_GOOGLE_MAPS) indisponível nesta instância do worker.',
        );
      },
    };
  }
  return new ApifyGatewayService(env.APIFY_API_TOKEN, env.APIFY_GOOGLE_MAPS_ACTOR_ID);
}

function createExploriumGateway(env: Env): ExploriumGateway {
  if (!env.EXPLORIUM_API_KEY) {
    return {
      searchBusinesses: async () => {
        throw new Error(
          'EXPLORIUM_API_KEY não configurado — scraping via Explorium (EXPLORIUM_BUSINESS_SEARCH) indisponível nesta instância do worker.',
        );
      },
      matchBusiness: async () => {
        throw new Error(
          'EXPLORIUM_API_KEY não configurado — enrichment via Explorium indisponível nesta instância do worker.',
        );
      },
    };
  }
  return new ExploriumGatewayService(env.EXPLORIUM_API_KEY);
}

function createCamofoxGateway(env: Env): CamofoxGateway {
  if (!env.CAMOFOX_API_URL) {
    return {
      search: async () => {
        throw new Error(
          'CAMOFOX_API_URL não configurado — scraping via camofox-browser (CAMOFOX_GOOGLE_SEARCH/CAMOFOX_REDDIT_SEARCH) indisponível nesta instância do worker.',
        );
      },
    };
  }
  return new CamofoxGatewayService(env.CAMOFOX_API_URL, env.CAMOFOX_ACCESS_KEY);
}

// Reaproveita `APIFY_API_TOKEN` (mesma conta/token do actor de Google Maps,
// ver `createApifyGateway` acima) — só os IDs dos dois actors (Task 9) são
// configuração nova.
function createContactEnrichmentGateway(env: Env): ContactEnrichmentGateway {
  if (!env.APIFY_API_TOKEN) {
    return {
      scrapeContactInfo: async () => {
        throw new Error(
          'APIFY_API_TOKEN não configurado — descoberta de contato/redes via Apify Actors indisponível nesta instância do worker (o passo cai para o fallback via Camoufox).',
        );
      },
      lookupInstagramProfile: async () => {
        throw new Error(
          'APIFY_API_TOKEN não configurado — lookup de perfil do Instagram via Apify indisponível nesta instância do worker.',
        );
      },
    };
  }
  return new ContactEnrichmentGatewayService(
    env.APIFY_API_TOKEN,
    env.APIFY_CONTACT_ENRICHMENT_ACTOR_ID,
    env.APIFY_INSTAGRAM_PROFILE_ACTOR_ID,
  );
}

async function main(): Promise<void> {
  // Mesmo fail-fast do apps/api — se DATABASE_URL_APP/REDIS_URL estiverem
  // faltando ou mal formados, o worker recusa subir com uma mensagem clara,
  // em vez de falhar de forma confusa no primeiro job.
  const env = validateEnv(process.env);
  const logger = createLogger(env);
  // Diferente de SCAN_INTERVAL_MS (fixo, ver comentário no topo do arquivo):
  // este intervalo é configurável por ambiente desde já (ver
  // packages/config/env/schema.ts) — um `ScrapeJob` automático tem custo
  // real (orçamento de scraping), então cada ambiente pode querer um ritmo
  // diferente sem precisar de rebuild.
  const PROSPECTING_SCAN_INTERVAL_MS = env.PROSPECTING_SCAN_INTERVAL_MS;
  // Mesmo racional de PROSPECTING_SCAN_INTERVAL_MS acima: cada busca via
  // Camoufox tem custo (rate-limit próprio, ver CamofoxGatewayService), então
  // este intervalo também é configurável por ambiente desde já (ver
  // packages/config/env/schema.ts), default 1 dia.
  const REDDIT_MINING_SCAN_INTERVAL_MS = env.REDDIT_MINING_SCAN_INTERVAL_MS;

  const prisma = createPrismaClient(env);
  // Uma única conexão Redis reaproveitada por ambos os pares fila/worker
  // (automations + lead-scrape) e pelo corte de orçamento de scraping
  // (`budget.ts`) — BullMQ já duplica internamente a conexão pros comandos
  // bloqueantes de cada Queue/Worker, e `incrbyfloat`/`expire`/`get` não são
  // bloqueantes, então uma conexão só para o processo inteiro é suficiente
  // (mesmo racional do comentário em `RedisService`, apps/api).
  const connection = createRedisConnection(env.REDIS_URL);

  const queue = createAutomationQueue(connection);
  const worker = createAutomationWorker(connection, (job) => processAutomationJob(prisma, job.data));

  worker.on('failed', (job, error) => {
    logger.error(
      { jobId: job?.id, automationId: job?.data.automationId, err: error },
      'job de automação falhou',
    );
    Sentry.captureException(error, { extra: { jobId: job?.id, automationId: job?.data.automationId } });
  });

  const gateways: LeadScrapeGateways = {
    apify: createApifyGateway(env),
    explorium: createExploriumGateway(env),
    camofox: createCamofoxGateway(env),
    contactEnrichment: createContactEnrichmentGateway(env),
  };
  const leadScrapeQueue = createLeadScrapeQueue(connection);
  // Fila `outreach-autodraft` (Task 11): só produtora aqui — quem consome é
  // `apps/api` (`outreach-autodraft.consumer.ts`). `processLeadScrapeJob`
  // enfileira nela logo depois de `upsertLead`, quando um lead qualifica com
  // ao menos um canal de contato (ver comentário no próprio processor).
  const outreachAutodraftQueue = createOutreachAutodraftQueue(connection);
  // Fila `reddit-clustering` (Task 13): só produtora aqui — quem consome é
  // `apps/api` (`reddit-clustering.consumer.ts`, Task 12). `runRedditMiningScan`
  // (abaixo) enfileira nela quando `scanRedditMiningTopics` encontra posts
  // candidatos para um `RedditWatchTopic` ativo.
  const redditClusteringQueue = createRedditClusteringQueue(connection);
  const leadScrapeWorker = createLeadScrapeWorker(connection, (job) =>
    processLeadScrapeJob(prisma, gateways, connection, job.data, (data) =>
      outreachAutodraftQueue.add('autodraft', data),
    ),
  );

  leadScrapeWorker.on('failed', (job, error) => {
    logger.error(
      { jobId: job?.id, scrapeJobId: job?.data.scrapeJobId, err: error },
      'job de scraping de leads falhou',
    );
    Sentry.captureException(error, { extra: { jobId: job?.id, scrapeJobId: job?.data.scrapeJobId } });
  });

  async function runScan(): Promise<void> {
    try {
      const enqueued = await scanCustomerInactiveAutomations(prisma, (data) => queue.add('execute', data));
      if (enqueued > 0) {
        logger.info({ enqueued }, 'scan enfileirou execuções de automação');
      }
    } catch (error) {
      logger.error({ err: error }, 'scan de automações falhou');
      Sentry.captureException(error);
    }
  }

  await runScan();
  setInterval(runScan, SCAN_INTERVAL_MS);

  // Scan de prospecção autônoma (Task 7) — mesmo formato de `runScan`
  // acima, rodando contra a mesma fila `leadScrapeQueue`/`connection` já
  // instanciadas nesta função (nenhuma fila/conexão nova).
  async function runProspectingScan(): Promise<void> {
    try {
      const created = await scanProspectingTargets(prisma, connection, (job, data) =>
        leadScrapeQueue.add('scrape', data),
      );
      if (created > 0) {
        logger.info({ created }, 'scan de prospecção enfileirou jobs de scraping');
      }
    } catch (error) {
      logger.error({ err: error }, 'scan de prospecção de alvos falhou');
      Sentry.captureException(error);
    }
  }

  await runProspectingScan();
  setInterval(runProspectingScan, PROSPECTING_SCAN_INTERVAL_MS);

  // Scan de mineração no Reddit (Task 13) — mesmo formato de `runScan`/
  // `runProspectingScan` acima, rodando contra o gateway Camoufox já
  // instanciado nesta função (`gateways.camofox`) e a fila
  // `redditClusteringQueue` recém-criada.
  async function runRedditMiningScan(): Promise<void> {
    try {
      const enqueued = await scanRedditMiningTopics(prisma, gateways.camofox, (data) =>
        redditClusteringQueue.add('cluster', data),
      );
      if (enqueued > 0) {
        logger.info({ enqueued }, 'scan de mineração no Reddit enfileirou jobs de clustering');
      }
    } catch (error) {
      logger.error({ err: error }, 'scan de mineração no Reddit falhou');
      Sentry.captureException(error);
    }
  }

  await runRedditMiningScan();
  setInterval(runRedditMiningScan, REDDIT_MINING_SCAN_INTERVAL_MS);

  logger.info(
    `OpsMind worker rodando — filas "${queue.name}" (scan a cada ${SCAN_INTERVAL_MS}ms) e "${leadScrapeQueue.name}"`,
  );
  logger.info(`Scan de prospecção autônoma a cada ${PROSPECTING_SCAN_INTERVAL_MS}ms`);
  logger.info(`Scan de mineração no Reddit a cada ${REDDIT_MINING_SCAN_INTERVAL_MS}ms`);
}

main().catch((error) => {
  // eslint-disable-next-line no-console -- falha antes de o logger existir
  console.error('[worker] falha fatal no bootstrap:', error);
  Sentry.captureException(error);
  process.exit(1);
});
