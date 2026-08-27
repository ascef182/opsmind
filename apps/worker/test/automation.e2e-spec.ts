import { randomUUID } from 'crypto';
import { validateEnv } from '@opsmind/config/env/schema';
import { createPrismaClient } from '../src/tenant-context';
import { createAutomationQueue, createAutomationWorker, createRedisConnection } from '../src/queue';
import { processAutomationJob } from '../src/automation-processor';
import { scanCustomerInactiveAutomations } from '../src/automation-scan';

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

  it('não dispara para um cliente que teve atividade recente (dentro do período de inatividade)', async () => {
    const { customer } = await createFixtures(2);

    const enqueued = await scanCustomerInactiveAutomations(prisma, jest.fn());

    expect(enqueued).toBe(0);
    const task = await prisma.task.findFirst({ where: { customerId: customer.id } });
    expect(task).toBeNull();
  });
});
