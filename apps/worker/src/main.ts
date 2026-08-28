// Precisa ser o primeiro import de todo o processo (Sentry.init).
import './instrument';
import * as Sentry from '@sentry/node';
import { validateEnv } from '@opsmind/config/env/schema';
import { createLogger } from './logger';
import { createPrismaClient } from './tenant-context';
import { createAutomationQueue, createAutomationWorker, createRedisConnection } from './queue';
import { scanCustomerInactiveAutomations } from './automation-scan';
import { processAutomationJob } from './automation-processor';

// Intervalo do scan (trigger) — curto o bastante pra ser responsivo em
// dev/demo, sem martelar o Postgres à toa em produção real. Fixo por ora;
// vira env var se algum dia precisar ser ajustado por ambiente.
const SCAN_INTERVAL_MS = 60_000;

async function main(): Promise<void> {
  // Mesmo fail-fast do apps/api — se DATABASE_URL_APP/REDIS_URL estiverem
  // faltando ou mal formados, o worker recusa subir com uma mensagem clara,
  // em vez de falhar de forma confusa no primeiro job.
  const env = validateEnv(process.env);
  const logger = createLogger(env);

  const prisma = createPrismaClient(env);
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

  logger.info(`OpsMind worker rodando — fila "${queue.name}", scan a cada ${SCAN_INTERVAL_MS}ms`);
}

main().catch((error) => {
  // eslint-disable-next-line no-console -- falha antes de o logger existir
  console.error('[worker] falha fatal no bootstrap:', error);
  Sentry.captureException(error);
  process.exit(1);
});
