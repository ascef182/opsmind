/**
 * Pontua de novo os leads DISCOVERED sem score de uma organização, pelo
 * mesmo caminho do botão "Pontuar" (`LeadsService.score`): grava score,
 * status e histórico de estágio, e dispara o gatilho de qualificação
 * (investigação de site ou rascunho de IA, que gasta orçamento de IA).
 * Espera a fila de rascunhos esvaziar antes de sair.
 *
 * Uso: cd apps/api && pnpm exec dotenv -e ../../.env -- npx ts-node --transpile-only \
 *        scripts/rescore-unscored-leads.ts <organizationId> <actorUserId>
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { OUTREACH_AUTODRAFT_QUEUE } from '@opsmind/shared-types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { tenantContextStorage } from '../src/shared/context/tenant-context.storage';
import { LeadsService } from '../src/modules/leads/leads.service';

const DRAIN_TIMEOUT_MS = 5 * 60_000;

async function main() {
  const [organizationId, actorUserId] = process.argv.slice(2);
  if (!organizationId || !actorUserId) {
    throw new Error('Uso: rescore-unscored-leads.ts <organizationId> <actorUserId>');
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  const prisma = app.get(PrismaService);
  const leads = app.get(LeadsService);

  const pending = await prisma.lead.findMany({
    where: { organizationId, status: 'DISCOVERED', score: null },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  console.log(`${pending.length} leads para pontuar`);

  // Uma transação por lead: o gatilho de qualificação enfileira o rascunho, e
  // o consumer só gera depois de ver o commit (guard de rollback).
  for (const lead of pending) {
    const scored = await prisma.runInTransaction((tx) =>
      tenantContextStorage.run(tx, async () => {
        await tx.$executeRaw`SELECT set_config('app.current_user_id', ${actorUserId}, true)`;
        await tx.$executeRaw`SELECT set_config('app.current_org_id', ${organizationId}, true)`;
        return leads.score(organizationId, lead.id, actorUserId);
      }),
    );
    console.log(`${scored.status.padEnd(12)} ${String(scored.score).padStart(3)}  ${lead.name}`);
  }

  const connection = new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
  const queue = new Queue(OUTREACH_AUTODRAFT_QUEUE, { connection });
  const deadline = Date.now() + DRAIN_TIMEOUT_MS;
  for (;;) {
    const counts = await queue.getJobCounts('waiting', 'active', 'delayed');
    const remaining = (counts.waiting ?? 0) + (counts.active ?? 0) + (counts.delayed ?? 0);
    if (remaining === 0) break;
    if (Date.now() > deadline) {
      console.log(`${remaining} rascunhos ainda na fila; o worker da API termina depois`);
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  await queue.close();
  connection.disconnect();
  await app.close();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
