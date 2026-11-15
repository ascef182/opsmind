import { randomUUID } from 'crypto';
import { validateEnv } from '@opsmind/config/env/schema';
import { automationJobId } from '@opsmind/shared-types';
import { createPrismaClient } from '../src/tenant-context';
import { createAutomationQueue, createAutomationWorker, createRedisConnection } from '../src/queue';
import { processAutomationJob } from '../src/automation-processor';
import { scanCustomerInactiveAutomations, scanDealStageStaleAutomations } from '../src/automation-scan';

// Fase 5 (docs/planning/PRD.md §17): critério de aceitação — "um cliente sem
// atividade há N dias dispara automaticamente criação de tarefa +
// notificação, visível no log de execução." Contra a app real (Postgres +
// Redis via Docker Compose), com uma fila e um Worker BullMQ REAIS — não um
// mock estrutural do processamento. Fixtures criadas direto via Prisma (o
// worker não tem camada HTTP); a cobertura de RBAC/CRUD/endpoint manual de
// disparo fica em apps/api/test/automations.e2e-spec.ts.
describe('Automations engine (e2e)', () => {
  const env = validateEnv(process.env);
  const prisma = createPrismaClient(env);
  const connection = createRedisConnection(env.REDIS_URL);
  const queue = createAutomationQueue(connection);
  const worker = createAutomationWorker(connection, (job) => processAutomationJob(prisma, job.data));

  beforeAll(async () => {
    // Fila compartilhada com o processo real de dev — garante que nenhum job
    // de uma execução anterior (local) contamine esta suíte.
    await queue.obliterate({ force: true });
  });

  afterAll(async () => {
    await worker.close();
    await queue.close();
    connection.disconnect();
    await prisma.$disconnect();
  });

  /** Espera o worker terminar (completed OU failed) um job para este customerId. */
  function waitForJobDone(customerId: string, timeoutMs = 10_000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout esperando o worker processar o job')), timeoutMs);
      const onSettled = (job: { data: { customerId: string } }) => {
        if (job.data.customerId === customerId) {
          clearTimeout(timeout);
          worker.off('completed', onSettled);
          worker.off('failed', onSettled as never);
          resolve();
        }
      };
      worker.on('completed', onSettled);
      worker.on('failed', onSettled as never);
    });
  }

  async function createFixtures(inactiveDaysAgo: number) {
    const suffix = randomUUID();
    const user = await prisma.user.create({
      data: { email: `automation-${suffix}@opsmind.test`, passwordHash: 'x', name: 'Automation Owner' },
    });
    const organization = await prisma.organization.create({
      data: { name: 'Automation Co', slug: `automation-co-${suffix}` },
    });
    await prisma.membership.create({
      data: { userId: user.id, organizationId: organization.id, role: 'OWNER' },
    });
    const lastActivityAt = new Date();
    lastActivityAt.setDate(lastActivityAt.getDate() - inactiveDaysAgo);
    const customer = await prisma.customer.create({
      data: {
        organizationId: organization.id,
        name: 'Cliente Sumido',
        ownerUserId: user.id,
        lastActivityAt,
      },
    });
    const automation = await prisma.automation.create({
      data: {
        organizationId: organization.id,
        name: 'Cliente inativo',
        trigger: 'CUSTOMER_INACTIVE',
        actions: { createTask: true, notify: true },
      },
    });
    return { user, organization, customer, automation };
  }

  it('scan encontra o cliente inativo, o worker processa o job de verdade, e cria tarefa + notificação + log', async () => {
    const { organization, customer, automation, user } = await createFixtures(20);

    const enqueued = await scanCustomerInactiveAutomations(prisma, (data) => queue.add('execute', data));
    expect(enqueued).toBe(1);

    await waitForJobDone(customer.id);

    const task = await prisma.task.findFirst({ where: { organizationId: organization.id, customerId: customer.id } });
    expect(task?.title).toBe('Retomar contato com Cliente Sumido');
    expect(task?.actorType).toBe('AUTOMATION');
    expect(task?.actorId).toBe(automation.id);

    const notification = await prisma.notification.findFirst({
      where: { organizationId: organization.id, userId: user.id, type: 'automation.customer_inactive' },
    });
    expect(notification).toBeTruthy();

    const run = await prisma.automationRun.findFirst({
      where: { automationId: automation.id, customerId: customer.id },
    });
    expect(run?.status).toBe('SUCCESS');
    expect(run?.actorType).toBe('SYSTEM');

    const auditLog = await prisma.auditLog.findFirst({
      where: { organizationId: organization.id, action: 'automation.executed' },
    });
    expect(auditLog).toBeTruthy();
  }, 15_000);

  it('não dispara de novo pro mesmo cliente numa segunda passada do scan (dedup)', async () => {
    const { organization, customer, automation } = await createFixtures(20);

    const firstScan = await scanCustomerInactiveAutomations(prisma, (data) => queue.add('execute', data));
    expect(firstScan).toBe(1);
    await waitForJobDone(customer.id);

    const secondScan = await scanCustomerInactiveAutomations(prisma, (data) => queue.add('execute', data));
    expect(secondScan).toBe(0);

    const tasks = await prisma.task.findMany({ where: { organizationId: organization.id, customerId: customer.id } });
    expect(tasks).toHaveLength(1);

    const runs = await prisma.automationRun.findMany({ where: { automationId: automation.id, customerId: customer.id } });
    expect(runs).toHaveLength(1);
  }, 15_000);

  // Complementa o teste de dedup acima (que prova dedup na camada do scan,
  // reconsultando o Postgres): este prova dedup na camada da fila em si —
  // dois `queue.add` de volta a volta pro MESMO par (automação, alvo), antes
  // do primeiro job terminar, devem resultar no MESMO job BullMQ.
  it('automationJobId faz o BullMQ deduplicar dois enqueues do mesmo par (automação, alvo) antes do primeiro job terminar', async () => {
    const data = { organizationId: 'org-x', automationId: 'auto-x', customerId: 'cust-x', actorType: 'SYSTEM' as const };
    const jobId = automationJobId(data);

    // Pausa local do worker real do describe — sem isso ele pega o job
    // (dados fake, nunca existiram no Postgres) quase instantaneamente e
    // trava o lock antes do `job1.remove()` de limpeza abaixo
    // ("Job ... could not be removed because it is locked by another
    // worker", confirmado rodando contra Redis real). O ponto do teste é a
    // dedup no enqueue, não o processamento — pausar não enfraquece a prova.
    await worker.pause();
    try {
      const job1 = await queue.add('execute', data, { jobId });
      const job2 = await queue.add('execute', data, { jobId });

      // Mesmo jobId, job ainda não processado (waiting/active) => BullMQ devolve
      // o MESMO job em vez de criar um segundo — é a prova real de dedup.
      expect(job2.id).toBe(job1.id);

      await job1.remove(); // limpeza — não deixar pendurado pra não interferir nos outros testes do arquivo
    } finally {
      await worker.resume();
    }
  });

  it('não dispara para um cliente que teve atividade recente (dentro do período de inatividade)', async () => {
    const { customer } = await createFixtures(2);

    const enqueued = await scanCustomerInactiveAutomations(prisma, jest.fn());

    expect(enqueued).toBe(0);
    const task = await prisma.task.findFirst({ where: { customerId: customer.id } });
    expect(task).toBeNull();
  });

  // Spec (docs/superpowers/specs/2026-11-14-funil-ativo-design.md, seção
  // "Verificação"): "e2e: criar Deal, forçar stageEnteredAt pro passado,
  // rodar o scan, confirmar Task criada uma única vez mesmo em duas
  // passadas." Mesmo padrão de fixtures/helpers de `createFixtures` acima,
  // mas para DEAL_STAGE_STALE (deal + automação de deal, em vez de cliente
  // inativo) — reusa o mesmo `prisma`/`queue`/`worker` reais do describe
  // pai (o worker já despacha por `automation.trigger` dentro de
  // `processAutomationJob`, nenhum setup adicional de fila necessário).
  async function createDealStageStaleFixtures(stageEnteredHoursAgo: number) {
    const suffix = randomUUID();
    const user = await prisma.user.create({
      data: { email: `automation-deal-${suffix}@opsmind.test`, passwordHash: 'x', name: 'Deal Owner' },
    });
    const organization = await prisma.organization.create({
      data: { name: 'Automation Deals Co', slug: `automation-deals-co-${suffix}` },
    });
    await prisma.membership.create({
      data: { userId: user.id, organizationId: organization.id, role: 'OWNER' },
    });
    const customer = await prisma.customer.create({
      data: { organizationId: organization.id, name: 'Cliente do Negócio Parado', ownerUserId: user.id },
    });
    const stageEnteredAt = new Date();
    stageEnteredAt.setHours(stageEnteredAt.getHours() - stageEnteredHoursAgo);
    const deal = await prisma.deal.create({
      data: {
        organizationId: organization.id,
        customerId: customer.id,
        title: 'Contrato Parado',
        stage: 'QUALIFICATION', // default threshold de 72h (DEFAULT_EXPECTED_STAGE_DURATION_HOURS)
        value: 1000,
        ownerUserId: user.id,
        actorType: 'USER',
        actorId: user.id,
        stageEnteredAt,
      },
    });
    const automation = await prisma.automation.create({
      data: {
        organizationId: organization.id,
        name: 'Negócio parado na etapa',
        trigger: 'DEAL_STAGE_STALE',
        actions: { createTask: true, notify: true },
      },
    });
    return { user, organization, customer, deal, automation };
  }

  it('scan encontra o deal parado na etapa, o worker processa o job de verdade, e cria tarefa + notificação + log', async () => {
    const { organization, deal, automation, user } = await createDealStageStaleFixtures(100); // 100h > 72h (threshold de QUALIFICATION)

    const enqueued = await scanDealStageStaleAutomations(prisma, (data) => queue.add('execute', data));
    expect(enqueued).toBe(1);

    await waitForJobDone(deal.customerId);

    const task = await prisma.task.findFirst({ where: { organizationId: organization.id, customerId: deal.customerId } });
    expect(task?.title).toBe('Reativar negócio "Contrato Parado"');
    expect(task?.actorType).toBe('AUTOMATION');
    expect(task?.actorId).toBe(automation.id);

    const notification = await prisma.notification.findFirst({
      where: { organizationId: organization.id, userId: user.id, type: 'automation.deal_stage_stale' },
    });
    expect(notification).toBeTruthy();

    const run = await prisma.automationRun.findFirst({
      where: { automationId: automation.id, dealId: deal.id },
    });
    expect(run?.status).toBe('SUCCESS');
    expect(run?.actorType).toBe('SYSTEM');

    const auditLog = await prisma.auditLog.findFirst({
      where: { organizationId: organization.id, action: 'automation.executed', resource: `Automation:${automation.id}` },
    });
    expect(auditLog).toBeTruthy();
  }, 15_000);

  it('não dispara de novo pro mesmo deal numa segunda passada do scan (dedup) — Task criada uma única vez', async () => {
    const { organization, deal, automation } = await createDealStageStaleFixtures(100);

    const firstScan = await scanDealStageStaleAutomations(prisma, (data) => queue.add('execute', data));
    expect(firstScan).toBe(1);
    await waitForJobDone(deal.customerId);

    const secondScan = await scanDealStageStaleAutomations(prisma, (data) => queue.add('execute', data));
    expect(secondScan).toBe(0);

    const tasks = await prisma.task.findMany({ where: { organizationId: organization.id, customerId: deal.customerId } });
    expect(tasks).toHaveLength(1);

    const runs = await prisma.automationRun.findMany({ where: { automationId: automation.id, dealId: deal.id } });
    expect(runs).toHaveLength(1);
  }, 15_000);
});
