/**
 * Regera com o gerador atual os rascunhos DRAFT de uma organização feitos
 * antes do Sales Copy Intelligence (sem `strategy`) e cria rascunho para os
 * leads QUALIFIED que ainda não têm nenhum. Gasta orçamento de IA (rascunho +
 * revisão de qualidade, até 3 versões por lead). Nada é enviado.
 *
 * Uso: cd apps/api && pnpm exec dotenv -e ../../.env -- npx ts-node --transpile-only \
 *        scripts/regenerate-outreach-drafts.ts <organizationId> <actorUserId> [desde ISO-8601]
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { resolveAutodraftChannel } from '@opsmind/shared-types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { tenantContextStorage } from '../src/shared/context/tenant-context.storage';
import { OutreachDraftNotCreatedException, OutreachService } from '../src/modules/leads/outreach.service';
import type { OutreachMessage } from '@opsmind/database';

async function main() {
  const [organizationId, actorUserId] = process.argv.slice(2);
  if (!organizationId || !actorUserId) {
    throw new Error('Uso: regenerate-outreach-drafts.ts <organizationId> <actorUserId>');
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  const prisma = app.get(PrismaService);
  const outreach = app.get(OutreachService);

  // Mesmo prazo das rotas HTTP de gerar/regerar: até 6 chamadas de IA.
  const inTenant = <T>(fn: () => Promise<T>) =>
    prisma.runInTransaction(
      (tx) =>
        tenantContextStorage.run(tx, async () => {
          await tx.$executeRaw`SELECT set_config('app.current_user_id', ${actorUserId}, true)`;
          await tx.$executeRaw`SELECT set_config('app.current_org_id', ${organizationId}, true)`;
          return fn();
        }),
      90_000,
    );
  // Recorte opcional: só rascunhos criados e leads qualificados a partir desta data.
  const since = process.argv[4] ? new Date(process.argv[4]) : new Date(0);

  const report = (name: string, result: OutreachMessage | string) => {
    if (typeof result === 'string') {
      console.log(`  -         ${name}: ${result}`);
      return;
    }
    const review = result.qualityReview as { status: string; average?: number; attempts: number } | null;
    const quality = review?.status === 'REVIEWED' ? `${review.average?.toFixed(1)}` : 'n/r';
    console.log(
      `  ${String(result.strategy).padEnd(20)} ${result.channel.padEnd(12)} nota ${quality.padStart(4)} ` +
        `(${review?.attempts ?? 1}x)  ${name}`,
    );
  };

  const run = async (name: string, fn: () => Promise<OutreachMessage>) => {
    try {
      report(name, await inTenant(fn));
    } catch (error) {
      if (error instanceof OutreachDraftNotCreatedException) report(name, `não criado (${error.reason}) ${error.message}`);
      else report(name, `erro: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const drafts = await prisma.outreachMessage.findMany({
    where: { organizationId, status: 'DRAFT', strategy: null, createdAt: { gte: since } },
    select: { id: true, lead: { select: { name: true } } },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`${drafts.length} rascunhos antigos para regerar`);
  for (const draft of drafts) {
    await run(draft.lead.name, () => outreach.regenerate(organizationId, draft.id, actorUserId));
  }

  const qualifiedSince = await prisma.pipelineStageTransition.findMany({
    where: { organizationId, toStage: 'QUALIFIED', occurredAt: { gte: since }, leadId: { not: null } },
    select: { leadId: true },
  });
  const leadsWithoutDraft = await prisma.lead.findMany({
    where: {
      organizationId,
      status: 'QUALIFIED',
      outreachMessages: { none: {} },
      id: { in: qualifiedSince.map((transition) => transition.leadId!) },
    },
    orderBy: { name: 'asc' },
  });
  console.log(`${leadsWithoutDraft.length} leads qualificados sem rascunho`);
  for (const lead of leadsWithoutDraft) {
    const channel = resolveAutodraftChannel(lead);
    if (!channel) {
      report(lead.name, 'sem canal de contato');
      continue;
    }
    await run(lead.name, () =>
      outreach.generateDraft(organizationId, lead.id, { channel }, { type: 'USER', userId: actorUserId }),
    );
  }

  await app.close();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
