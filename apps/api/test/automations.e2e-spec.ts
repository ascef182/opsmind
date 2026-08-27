import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { AutomationQueueService } from '../src/infrastructure/queue/automation-queue.service';
import { registerUser } from './helpers/auth';

async function createOrg(app: INestApplication, accessToken: string) {
  const res = await request(app.getHttpServer())
    .post('/organizations')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ name: 'Automations Co', slug: `automations-co-${randomUUID()}` })
    .expect(201);
  return res.body.id as string;
}

// Fase 5 (docs/planning/PRD.md §17) — cobre o CRUD/RBAC/endpoint de disparo
// manual contra a API real (Postgres via Docker Compose). AutomationQueueService
// é sobrescrito por um mock: o mecanismo de fila BullMQ + o worker
// consumindo de verdade já são cobertos em apps/worker/test/
// automation.e2e-spec.ts — aqui o interesse é o contrato HTTP e o que é
// persistido, não reprocessar a mesma verificação de infraestrutura.
describe('Automations flow (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let queueService: { enqueue: jest.Mock };

  beforeAll(async () => {
    queueService = { enqueue: jest.fn().mockResolvedValue(undefined) };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AutomationQueueService)
      .useValue(queueService)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    queueService.enqueue.mockClear();
  });

  it('cria, lista, detalha uma automação, dispara manualmente e reflete no log de execução', async () => {
    const owner = await registerUser(app, `automations-owner-${randomUUID()}@opsmind.test`);
    const organizationId = await createOrg(app, owner.accessToken);
    const auth = { Authorization: `Bearer ${owner.accessToken}` };

    const createRes = await request(app.getHttpServer())
      .post(`/organizations/${organizationId}/automations`)
      .set(auth)
      .send({
        name: 'Cliente inativo',
        trigger: 'CUSTOMER_INACTIVE',
        actions: { createTask: true, notify: true },
      })
      .expect(201);
    const automationId = createRes.body.id;
    expect(createRes.body.enabled).toBe(true);

    await request(app.getHttpServer())
      .get(`/organizations/${organizationId}/automations`)
      .set(auth)
      .expect(200)
      .expect((res) => {
        expect(res.body.some((a: { id: string }) => a.id === automationId)).toBe(true);
      });

    await request(app.getHttpServer())
      .get(`/organizations/${organizationId}/automations/${automationId}`)
      .set(auth)
      .expect(200);

    // Cliente inativo de verdade (backdatado direto via Prisma, fora de
    // qualquer request HTTP — mesmo padrão já usado no resto da suíte e2e
    // pra simular passagem de tempo).
    const customerRes = await request(app.getHttpServer())
      .post(`/organizations/${organizationId}/customers`)
      .set(auth)
      .send({ name: 'Cliente Sumido' })
      .expect(201);
    const twentyDaysAgo = new Date();
    twentyDaysAgo.setDate(twentyDaysAgo.getDate() - 20);
    await prisma.customer.update({
      where: { id: customerRes.body.id },
      data: { lastActivityAt: twentyDaysAgo },
    });

    const runRes = await request(app.getHttpServer())
      .post(`/organizations/${organizationId}/automations/${automationId}/run`)
      .set(auth)
      .expect(201);
    expect(runRes.body).toEqual({ enqueued: 1 });
    expect(queueService.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId,
        automationId,
        customerId: customerRes.body.id,
        actorType: 'USER',
        actorId: owner.userId,
      }),
    );

    const auditRes = await request(app.getHttpServer())
      .get(`/organizations/${organizationId}/audit-logs`)
      .set(auth)
      .expect(200);
    expect(auditRes.body.map((log: { action: string }) => log.action)).toContain('automation.created');
  });

  it('rejeita criação/disparo por um membro VIEWER (RBAC), mas permite leitura', async () => {
    const owner = await registerUser(app, `automations-owner2-${randomUUID()}@opsmind.test`);
    const viewer = await registerUser(app, `automations-viewer-${randomUUID()}@opsmind.test`);
    const organizationId = await createOrg(app, owner.accessToken);
    const ownerAuth = { Authorization: `Bearer ${owner.accessToken}` };
    const viewerAuth = { Authorization: `Bearer ${viewer.accessToken}` };

    const logSpy = jest.spyOn(console, 'log').mockImplementation();
    await request(app.getHttpServer())
      .post(`/organizations/${organizationId}/invite`)
      .set(ownerAuth)
      .send({ email: viewer.email, role: 'VIEWER' })
      .expect(201);
    const logged = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    logSpy.mockRestore();
    const invitationToken = /token: (\S+)/.exec(logged)?.at(1);
    await request(app.getHttpServer())
      .post(`/invitations/${invitationToken}/accept`)
      .set(viewerAuth)
      .expect(201);

    const automationRes = await request(app.getHttpServer())
      .post(`/organizations/${organizationId}/automations`)
      .set(ownerAuth)
      .send({ name: 'Cliente inativo', trigger: 'CUSTOMER_INACTIVE', actions: { createTask: true } })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/organizations/${organizationId}/automations`)
      .set(viewerAuth)
      .send({ name: 'Outra', trigger: 'CUSTOMER_INACTIVE', actions: {} })
      .expect(403);

    await request(app.getHttpServer())
      .post(`/organizations/${organizationId}/automations/${automationRes.body.id}/run`)
      .set(viewerAuth)
      .expect(403);

    await request(app.getHttpServer())
      .get(`/organizations/${organizationId}/automations`)
      .set(viewerAuth)
      .expect(200);
  });

  it('rejeita disparo manual de automação desabilitada (400)', async () => {
    const owner = await registerUser(app, `automations-owner3-${randomUUID()}@opsmind.test`);
    const organizationId = await createOrg(app, owner.accessToken);
    const auth = { Authorization: `Bearer ${owner.accessToken}` };

    const automationRes = await request(app.getHttpServer())
      .post(`/organizations/${organizationId}/automations`)
      .set(auth)
      .send({
        name: 'Desabilitada',
        trigger: 'CUSTOMER_INACTIVE',
        actions: { createTask: true },
        enabled: false,
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/organizations/${organizationId}/automations/${automationRes.body.id}/run`)
      .set(auth)
      .expect(400);
    expect(queueService.enqueue).not.toHaveBeenCalled();
  });
});
