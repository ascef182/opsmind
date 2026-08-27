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
