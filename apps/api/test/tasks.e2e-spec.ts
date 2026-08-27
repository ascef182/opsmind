import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { registerUser } from './helpers/auth';

async function createOrg(app: INestApplication, accessToken: string) {
  const res = await request(app.getHttpServer())
    .post('/organizations')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ name: 'Tasks Co', slug: `tasks-co-${randomUUID()}` })
    .expect(201);
  return res.body.id as string;
}

async function createCustomer(app: INestApplication, accessToken: string, organizationId: string) {
  const res = await request(app.getHttpServer())
    .post(`/organizations/${organizationId}/customers`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ name: 'Acme Corp' })
    .expect(201);
  return res.body.id as string;
}

// Fase 2 (docs/planning/PRD.md §17): CRUD de Tasks vinculadas a clientes.
// Critério de aceitação: "criar e concluir uma tarefa, e ver tudo refletido
// na timeline" — contra a app real (Postgres via Docker Compose).
describe('Tasks flow (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('cria uma tarefa vinculada a um cliente, conclui, e reflete na timeline do cliente', async () => {
    const owner = await registerUser(app, `tasks-owner-${randomUUID()}@opsmind.test`);
    const organizationId = await createOrg(app, owner.accessToken);
    const auth = { Authorization: `Bearer ${owner.accessToken}` };
    const customerId = await createCustomer(app, owner.accessToken, organizationId);

    const createRes = await request(app.getHttpServer())
      .post(`/organizations/${organizationId}/tasks`)
      .set(auth)
      .send({ title: 'Follow-up da proposta', customerId, assigneeId: owner.userId })
      .expect(201);
    const taskId = createRes.body.id;
    expect(createRes.body.status).toBe('OPEN');
    expect(createRes.body.completedAt).toBeNull();

    await request(app.getHttpServer())
      .get(`/organizations/${organizationId}/tasks`)
      .set(auth)
      .expect(200)
      .expect((res) => {
        expect(res.body.some((t: { id: string }) => t.id === taskId)).toBe(true);
      });

    const completeRes = await request(app.getHttpServer())
      .patch(`/organizations/${organizationId}/tasks/${taskId}`)
      .set(auth)
      .send({ status: 'DONE' })
      .expect(200);
    expect(completeRes.body.status).toBe('DONE');
    expect(completeRes.body.completedAt).not.toBeNull();

    const timelineRes = await request(app.getHttpServer())
      .get(`/organizations/${organizationId}/customers/${customerId}/timeline`)
      .set(auth)
      .expect(200);
    expect(timelineRes.body.some((a: { type: string }) => a.type === 'task.completed')).toBe(true);
  });

  it('notifica o responsável ao atribuir a tarefa a outra pessoa', async () => {
    const owner = await registerUser(app, `tasks-notif-owner-${randomUUID()}@opsmind.test`);
    const member = await registerUser(app, `tasks-notif-member-${randomUUID()}@opsmind.test`);
    const organizationId = await createOrg(app, owner.accessToken);

    const logSpy = jest.spyOn(console, 'log').mockImplementation();
    await request(app.getHttpServer())
      .post(`/organizations/${organizationId}/invite`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ email: member.email, role: 'MEMBER' })
      .expect(201);
    const token = /token: (\S+)/.exec(logSpy.mock.calls.map((c) => c.join(' ')).join('\n'))?.at(1);
    logSpy.mockRestore();
    await request(app.getHttpServer())
      .post(`/invitations/${token}/accept`)
      .set('Authorization', `Bearer ${member.accessToken}`)
      .expect(201);

    const taskRes = await request(app.getHttpServer())
      .post(`/organizations/${organizationId}/tasks`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ title: 'Responder o cliente', assigneeId: member.userId })
      .expect(201);

    const notificationsRes = await request(app.getHttpServer())
      .get(`/organizations/${organizationId}/notifications`)
      .set('Authorization', `Bearer ${member.accessToken}`)
      .expect(200);
    expect(notificationsRes.body).toHaveLength(1);
    expect(notificationsRes.body[0].type).toBe('task.assigned');
    expect(notificationsRes.body[0].readAt).toBeNull();

    const notificationId = notificationsRes.body[0].id;
    await request(app.getHttpServer())
      .patch(`/organizations/${organizationId}/notifications/${notificationId}/read`)
      .set('Authorization', `Bearer ${member.accessToken}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.readAt).not.toBeNull();
      });

    // O owner não vê a notificação de outro usuário.
    await request(app.getHttpServer())
      .get(`/organizations/${organizationId}/notifications`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200)
      .expect((res) => {
        expect(res.body).toHaveLength(0);
      });

    expect(taskRes.body.assigneeId).toBe(member.userId);
  });

  it('rejeita tarefa vinculada a cliente de outra organização', async () => {
    const owner = await registerUser(app, `tasks-cross-owner-${randomUUID()}@opsmind.test`);
    const orgA = await createOrg(app, owner.accessToken);
    const orgB = await createOrg(app, owner.accessToken);
    const customerInB = await createCustomer(app, owner.accessToken, orgB);

    await request(app.getHttpServer())
      .post(`/organizations/${orgA}/tasks`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ title: 'Cross-tenant?', customerId: customerInB })
      .expect(404);
  });
});
