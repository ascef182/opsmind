import { randomUUID } from 'crypto';
import { validateEnv } from '@opsmind/config/env/schema';
import { Queue } from 'bullmq';
import { createPrismaClient } from '../src/tenant-context';
import { createRedisConnection } from '../src/queue';
import { harveyScrapeJobId, runHarveyTick, type HarveyTickDeps } from '../src/harvey-orchestrator';

// Harvey Fase 1: duas réplicas do worker rodando o tick ao mesmo tempo, cada
// uma com a sua conexão, contra o mesmo Postgres real. Nada pode duplicar:
// ciclo do dia, busca por alvo, nem trabalho enfileirado.
describe('Harvey orchestrator (e2e)', () => {
  const env = validateEnv(process.env);
  const replicaA = createPrismaClient(env);
  const replicaB = createPrismaClient(env);

  afterAll(async () => {
    await replicaA.$disconnect();
    await replicaB.$disconnect();
  });

  function deps(prisma: typeof replicaA, added: string[]): HarveyTickDeps {
    const queue = (name: string) => ({
      add: async (_job: string, data: { scrapeJobId?: string; leadId?: string }) => {
        added.push(`${name}:${data.scrapeJobId ?? data.leadId}`);
      },
    });
    return {
      prisma,
      kv: { get: async () => null, set: async () => undefined, claim: async () => true },
      queues: {
        leadScrape: queue('scrape'),
        websiteProfile: queue('profile'),
        outreachAutodraft: queue('draft'),
        sendReconcile: queue('reconcile'),
      } as never,
      isQueueJobAlive: async () => false,
    };
  }

  async function createActiveOrg(targets: number) {
    const suffix = randomUUID();
    const organization = await replicaA.organization.create({ data: { name: 'Harvey Replicas', slug: `harvey-rep-${suffix}` } });
    const campaign = await replicaA.salesCampaign.create({
      data: {
        organizationId: organization.id,
        name: 'Dentista — Campinas/SP',
        kind: 'STANDARD',
        segment: 'dentista',
        city: 'Campinas',
        state: 'SP',
        identityKey: `dentista|campinas|sp|${suffix}`,
        country: 'BR',
        language: 'pt-BR',
        timezone: 'UTC',
        workingDays: [1, 2, 3, 4, 5, 6, 7],
        workStartMinute: 0,
        workEndMinute: 1440,
      },
    });
    await replicaA.harveyAgent.create({ data: { organizationId: organization.id, controlState: 'ACTIVE' } });
    for (let i = 0; i < targets; i += 1) {
      await replicaA.prospectingTarget.create({
        data: {
          organizationId: organization.id,
          campaignId: campaign.id,
          city: `Cidade ${i}`,
          state: 'SP',
          businessType: 'dentista',
        },
      });
    }
    return { organizationId: organization.id, campaignId: campaign.id };
  }

  it('two concurrent ticks create one run and one scrape job', async () => {
    const { organizationId, campaignId } = await createActiveOrg(3);
    const added: string[] = [];

    const results = await Promise.all([
      runHarveyTick(deps(replicaA, added), organizationId),
      runHarveyTick(deps(replicaB, added), organizationId),
    ]);

    const runs = await replicaA.harveyRun.findMany({ where: { campaignId } });
    const scrapeJobs = await replicaA.scrapeJob.findMany({ where: { organizationId } });
    const started = await replicaA.harveyActivity.count({ where: { organizationId, type: 'run.started' } });
    expect(runs).toHaveLength(1);
    expect(started).toBe(1);
    // Uma busca por vez por ciclo; a outra réplica ou pulou pela trava ou viu a busca em andamento.
    expect(scrapeJobs).toHaveLength(1);
    expect(added.filter((entry) => entry.startsWith('scrape:'))).toHaveLength(1);
    expect(results.reduce((total, summary) => total + summary.runsOpened, 0)).toBe(1);
  });

  it('many concurrent ticks still never duplicate the search of a target in the same cycle', async () => {
    const { organizationId } = await createActiveOrg(1);
    const added: string[] = [];
    await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        runHarveyTick(deps(index % 2 === 0 ? replicaA : replicaB, added), organizationId),
      ),
    );
    // Termina a busca e roda de novo: o mesmo alvo não é buscado de novo no mesmo ciclo.
    await replicaA.scrapeJob.updateMany({ where: { organizationId }, data: { status: 'COMPLETED' } });
    await Promise.all([
      runHarveyTick(deps(replicaA, added), organizationId),
      runHarveyTick(deps(replicaB, added), organizationId),
    ]);
    expect(await replicaA.scrapeJob.count({ where: { organizationId } })).toBe(1);
  });

  it('a paused agent gets no new work', async () => {
    const { organizationId } = await createActiveOrg(2);
    await replicaA.harveyAgent.update({ where: { organizationId }, data: { controlState: 'PAUSED' } });
    const added: string[] = [];
    await runHarveyTick(deps(replicaA, added), organizationId);
    expect(await replicaA.harveyRun.count({ where: { organizationId } })).toBe(0);
    expect(await replicaA.scrapeJob.count({ where: { organizationId } })).toBe(0);
    expect(added).toEqual([]);
  });

  it('enqueues the search in a real BullMQ queue with an accepted job id', async () => {
    const { organizationId } = await createActiveOrg(1);
    const connection = createRedisConnection(env.REDIS_URL);
    // Fila isolada só deste teste: nenhum worker consome, nada é cobrado.
    const queue = new Queue(`harvey-e2e-${randomUUID()}`, { connection });
    try {
      const realDeps = deps(replicaA, []);
      realDeps.queues.leadScrape = queue as never;
      await runHarveyTick(realDeps, organizationId);
      const scrapeJob = await replicaA.scrapeJob.findFirstOrThrow({ where: { organizationId } });
      const job = await queue.getJob(harveyScrapeJobId(scrapeJob.id));
      expect(job?.data).toEqual(expect.objectContaining({ scrapeJobId: scrapeJob.id }));
    } finally {
      await queue.obliterate({ force: true });
      await queue.close();
      connection.disconnect();
    }
  });
});
