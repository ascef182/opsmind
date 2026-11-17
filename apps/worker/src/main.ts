// Precisa ser o primeiro import de todo o processo (Sentry.init).
import './instrument';
import * as Sentry from '@sentry/node';
import { validateEnv, type Env } from '@opsmind/config/env/schema';
import { automationJobId } from '@opsmind/shared-types';
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
import { createWebsiteProfilerQueue, createWebsiteProfilerWorker } from './website-profiler-queue';
import { createOutreachAutodraftQueue } from './outreach-autodraft-queue';
import { createRedditClusteringQueue } from './reddit-clustering-queue';
import { createRedditTopicScanWorker } from './reddit-topic-scan-queue';
import {
  scanCustomerInactiveAutomations,
  scanDealStageStaleAutomations,
  scanDealSilentForAutomations,
} from './automation-scan';
import { scanRedditMiningTopics } from './reddit-mining-scan';
import { processRedditTopicScanJob } from './reddit-topic-scan-processor';
import { scanOutreachFollowups } from './outreach-followup-scan';
import { scanTaskDueReminders } from './task-due-reminder-scan';
import { scanMeetingReminders } from './meeting-reminder-scan';
import { scanSpendAlerts } from './spend-alert-scan';
import { processAutomationJob } from './automation-processor';
import { processLeadScrapeJob, type LeadScrapeGateways } from './lead-scrape-processor';
import { processWebsiteProfileJob } from './website-profiler-processor';
import { runHarveyTick } from './harvey-orchestrator';
import { createHarveyPublisher } from './harvey-events';
import {
  createHarveyOrchestratorQueue,
  createHarveyOrchestratorWorker,
  createSendReconcileQueue,
  registerHarveySchedulers,
} from './harvey-orchestrator-queue';

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
  // Configurável por ambiente: cada busca via
  // Camoufox tem custo (rate-limit próprio, ver CamofoxGatewayService), então
  // este intervalo também é configurável por ambiente desde já (ver
  // packages/config/env/schema.ts), default 1 dia.
  const REDDIT_MINING_SCAN_INTERVAL_MS = env.REDDIT_MINING_SCAN_INTERVAL_MS;
  // Lembrete de follow-up (plano pensando-como-empresa-com-agile-beaver.md)
  // — mesmo racional de configurabilidade por ambiente dos dois intervalos
  // acima (sem custo de API por trás, mas o ritmo ainda pode variar por
  // instância/demo vs. produção).
  const OUTREACH_FOLLOWUP_SCAN_INTERVAL_MS = env.OUTREACH_FOLLOWUP_SCAN_INTERVAL_MS;
  const OUTREACH_FOLLOWUP_THRESHOLD_DAYS = env.OUTREACH_FOLLOWUP_THRESHOLD_DAYS;
  const MEETING_REMINDER_MINUTES_BEFORE = env.MEETING_REMINDER_MINUTES_BEFORE;

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
  const harveyPublish = createHarveyPublisher(connection);
  // Fila `outreach-autodraft` (Task 11): só produtora aqui — quem consome é
  // `apps/api` (`outreach-autodraft.consumer.ts`). `processLeadScrapeJob`
  // enfileira nela logo depois de `upsertLead`, quando um lead qualifica com
  // ao menos um canal de contato (ver comentário no próprio processor).
  const outreachAutodraftQueue = createOutreachAutodraftQueue(connection);
  // Fila `website-profile`: produtora aqui também (não só em apps/api) —
  // `processLeadScrapeJob` enfileira nela quando um lead recém-QUALIFIED
  // tem site e ainda não foi investigado, pra citar evidência real no
  // rascunho gerado depois (ver comentário no processor).
  const websiteProfilerQueue = createWebsiteProfilerQueue(connection);
  // Fila `reddit-clustering` (Task 13): só produtora aqui — quem consome é
  // `apps/api` (`reddit-clustering.consumer.ts`, Task 12). `runRedditMiningScan`
  // (abaixo) enfileira nela quando `scanRedditMiningTopics` encontra posts
  // candidatos para um `RedditWatchTopic` ativo.
  const redditClusteringQueue = createRedditClusteringQueue(connection);
  // Fila `reddit-topic-scan` (E5, "Verificar agora" da UI): só consumidora
  // aqui — quem produz é `apps/api` (`POST .../reddit-watch-topics/:id/scan-now`
  // e `RedditWatchTopicsService.create()`). Reaproveita `gateways.camofox` e
  // `redditClusteringQueue` já instanciados nesta função, mesma lógica de
  // `runRedditMiningScan` abaixo (via `scanOneRedditWatchTopic`).
  const redditTopicScanWorker = createRedditTopicScanWorker(connection, (job) =>
    processRedditTopicScanJob(prisma, gateways.camofox, connection, job.data, (data) =>
      redditClusteringQueue.add('cluster', data),
    ),
  );

  redditTopicScanWorker.on('failed', (job, error) => {
    logger.error(
      { jobId: job?.id, topicId: job?.data.topicId, err: error },
      'job de scan sob demanda do Reddit falhou',
    );
    Sentry.captureException(error, { extra: { jobId: job?.id, topicId: job?.data.topicId } });
  });

  const leadScrapeWorker = createLeadScrapeWorker(connection, (job) =>
    processLeadScrapeJob(
      prisma,
      gateways,
      connection,
      job.data,
      (data) =>
        outreachAutodraftQueue.add('autodraft', data, { deduplication: { id: `outreach-autodraft:${data.leadId}` } }),
      (data) =>
        websiteProfilerQueue.add('investigate', data, { deduplication: { id: `website-profile:${data.leadId}` } }),
      // Fallback automático Apify→Camofox (ver maybeEnqueueApifyFallback em
      // lead-scrape-processor.ts) — reaproveita a MESMA fila `leadScrapeQueue`
      // já instanciada acima (também usada por `runProspectingScan`), não uma
      // fila nova.
      (data) => leadScrapeQueue.add('scrape', data),
      { queueJobId: job.id, publish: harveyPublish },
    ),
  );

  leadScrapeWorker.on('failed', (job, error) => {
    logger.error(
      { jobId: job?.id, scrapeJobId: job?.data.scrapeJobId, err: error },
      'job de scraping de leads falhou',
    );
    Sentry.captureException(error, { extra: { jobId: job?.id, scrapeJobId: job?.data.scrapeJobId } });
  });

  // Fila `website-profile` — só consumidora aqui; quem produz é `apps/api`
  // (`POST .../leads/:leadId/investigate`, e mais adiante a tool de IA
  // `investigate_company_website`). Ver
  // docs/planning/2026-11-06-harvey-inteligencia-comercial.md §5.
  const websiteProfilerWorker = createWebsiteProfilerWorker(connection, (job) =>
    processWebsiteProfileJob(
      prisma,
      job.data,
      (data) =>
        outreachAutodraftQueue.add('autodraft', data, { deduplication: { id: `outreach-autodraft:${data.leadId}` } }),
      { queueJobId: job.id, publish: harveyPublish },
    ),
  );

  websiteProfilerWorker.on('failed', (job, error) => {
    logger.error({ jobId: job?.id, leadId: job?.data.leadId, err: error }, 'job de investigação de site falhou');
    Sentry.captureException(error, { extra: { jobId: job?.id, leadId: job?.data.leadId } });
  });

  async function runScan(): Promise<void> {
    try {
      const enqueued = await scanCustomerInactiveAutomations(prisma, (data) =>
        queue.add('execute', data, { deduplication: { id: automationJobId(data) } }),
      );
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

  // Scans de automações de deal (DEAL_STAGE_STALE e DEAL_SILENT_FOR) — mesma
  // fila `queue` e mesmo `SCAN_INTERVAL_MS` de `runScan` acima (nenhuma fila
  // ou intervalo novo). Se o primeiro scan lançar, o segundo não roda neste
  // ciclo; o próximo tick (SCAN_INTERVAL_MS) tenta os dois de novo.
  async function runDealAutomationsScan(): Promise<void> {
    try {
      const staleCount = await scanDealStageStaleAutomations(prisma, (data) =>
        queue.add('execute', data, { deduplication: { id: automationJobId(data) } }),
      );
      const silentCount = await scanDealSilentForAutomations(prisma, (data) =>
        queue.add('execute', data, { deduplication: { id: automationJobId(data) } }),
      );
      const enqueued = staleCount + silentCount;
      if (enqueued > 0) {
        logger.info({ enqueued }, 'scan de automações de deal enfileirou execuções');
      }
    } catch (error) {
      logger.error({ err: error }, 'scan de automações de deal falhou');
      Sentry.captureException(error);
    }
  }

  await runDealAutomationsScan();
  setInterval(runDealAutomationsScan, SCAN_INTERVAL_MS);

  // Lembrete de vencimento de tarefa (plano
  // pensando-como-empresa-com-agile-beaver.md) — mesmo intervalo fixo
  // `SCAN_INTERVAL_MS` de `runScan` acima (sem custo de API por trás, e
  // vencimento de tarefa é sensível a tempo — checagem a cada 60s é
  // responsiva sem ser cara).
  async function runTaskDueReminderScan(): Promise<void> {
    try {
      const notified = await scanTaskDueReminders(prisma);
      if (notified > 0) {
        logger.info({ notified }, 'scan de lembrete de vencimento notificou responsáveis');
      }
    } catch (error) {
      logger.error({ err: error }, 'scan de lembrete de vencimento falhou');
      Sentry.captureException(error);
    }
  }

  await runTaskDueReminderScan();
  setInterval(runTaskDueReminderScan, SCAN_INTERVAL_MS);

  // Lembrete de reunião (plano pensando-como-empresa-com-agile-beaver.md) —
  // mesmo intervalo fixo `SCAN_INTERVAL_MS` de `runTaskDueReminderScan`
  // acima (sem custo de API por trás, sensível a tempo).
  async function runMeetingReminderScan(): Promise<void> {
    try {
      const notified = await scanMeetingReminders(prisma, MEETING_REMINDER_MINUTES_BEFORE);
      if (notified > 0) {
        logger.info({ notified }, 'scan de lembrete de reunião notificou responsáveis');
      }
    } catch (error) {
      logger.error({ err: error }, 'scan de lembrete de reunião falhou');
      Sentry.captureException(error);
    }
  }

  await runMeetingReminderScan();
  setInterval(runMeetingReminderScan, SCAN_INTERVAL_MS);

  // Harvey: a prospecção autônoma agora é o orquestrador (tick por minuto,
  // agendado no BullMQ e único entre réplicas), que só trabalha com o agente
  // ativo. O follow-up de outreach roda no mesmo agendamento.
  const sendReconcileQueue = createSendReconcileQueue(connection);
  const queuesByName = new Map<string, { getJob(id: string): Promise<{ getState(): Promise<string> } | undefined> }>([
    [leadScrapeQueue.name, leadScrapeQueue],
    [websiteProfilerQueue.name, websiteProfilerQueue],
    [outreachAutodraftQueue.name, outreachAutodraftQueue],
  ]);
  const harveyQueue = createHarveyOrchestratorQueue(connection);
  const harveyWorker = createHarveyOrchestratorWorker(connection, async (job) => {
    if (job.name === 'followup') {
      const notified = await scanOutreachFollowups(prisma, OUTREACH_FOLLOWUP_THRESHOLD_DAYS);
      if (notified > 0) logger.info({ notified }, 'scan de follow-up de outreach notificou usuários');
      return;
    }
    const summary = await runHarveyTick(
      {
        prisma,
        kv: {
          get: (key) => connection.get(key),
          set: (key, value) => connection.set(key, value),
          claim: async (key, ttlSeconds) => (await connection.set(key, '1', 'EX', ttlSeconds, 'NX')) === 'OK',
        },
        queues: {
          leadScrape: leadScrapeQueue,
          websiteProfile: websiteProfilerQueue,
          outreachAutodraft: outreachAutodraftQueue,
          sendReconcile: sendReconcileQueue,
        },
        isQueueJobAlive: async (queueName, jobId) => {
          const found = await queuesByName.get(queueName)?.getJob(jobId);
          if (!found) return false;
          return ['active', 'waiting', 'delayed', 'prioritized', 'waiting-children'].includes(await found.getState());
        },
        publish: harveyPublish,
      },
      job.data.organizationId,
    );
    if (summary.scrapeJobs + summary.profiles + summary.drafts + summary.runsOpened + summary.runsClosed > 0) {
      logger.info(summary, 'tick do Harvey');
    }
  });
  harveyWorker.on('failed', (job, error) => {
    logger.error({ jobId: job?.id, err: error }, 'tick do Harvey falhou');
    Sentry.captureException(error, { extra: { jobId: job?.id } });
  });
  await registerHarveySchedulers(harveyQueue, OUTREACH_FOLLOWUP_SCAN_INTERVAL_MS);

  // Scan de mineração no Reddit (Task 13) — mesmo formato de `runScan`/
  // `runProspectingScan` acima, rodando contra o gateway Camoufox já
  // instanciado nesta função (`gateways.camofox`), a fila
  // `redditClusteringQueue` recém-criada e a mesma `connection` Redis que o
  // corte/registro de orçamento de scraping usa nos outros dois caminhos.
  async function runRedditMiningScan(): Promise<void> {
    try {
      const enqueued = await scanRedditMiningTopics(prisma, gateways.camofox, connection, (data) =>
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

  // Alertas de gasto (50/80/100% dos tetos de IA e do Revenue Engine). De
  // hora em hora: é aviso; o corte síncrono fica em cada caminho que gasta.
  const SPEND_ALERT_SCAN_INTERVAL_MS = 3_600_000;
  async function runSpendAlertScan(): Promise<void> {
    try {
      const notified = await scanSpendAlerts(prisma, connection);
      if (notified > 0) {
        logger.info({ notified }, 'scan de alertas de gasto notificou administradores');
      }
    } catch (error) {
      logger.error({ err: error }, 'scan de alertas de gasto falhou');
      Sentry.captureException(error);
    }
  }

  await runSpendAlertScan();
  setInterval(runSpendAlertScan, SPEND_ALERT_SCAN_INTERVAL_MS);

  logger.info(
    `OpsMind worker rodando — filas "${queue.name}" (scan a cada ${SCAN_INTERVAL_MS}ms), "${leadScrapeQueue.name}" e "${redditTopicScanWorker.name}"`,
  );
  logger.info('Harvey: tick a cada 60s via job scheduler do BullMQ (único entre réplicas)');
  logger.info(`Scan de mineração no Reddit a cada ${REDDIT_MINING_SCAN_INTERVAL_MS}ms`);
  logger.info(
    `Scan de follow-up de outreach a cada ${OUTREACH_FOLLOWUP_SCAN_INTERVAL_MS}ms (threshold ${OUTREACH_FOLLOWUP_THRESHOLD_DAYS} dias)`,
  );
  logger.info(`Scan de lembrete de vencimento de tarefa a cada ${SCAN_INTERVAL_MS}ms`);
  logger.info(
    `Scan de lembrete de reunião a cada ${SCAN_INTERVAL_MS}ms (${MEETING_REMINDER_MINUTES_BEFORE} min antes)`,
  );
}

main().catch((error) => {
  // eslint-disable-next-line no-console -- falha antes de o logger existir
  console.error('[worker] falha fatal no bootstrap:', error);
  Sentry.captureException(error);
  process.exit(1);
});
