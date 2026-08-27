import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { registerUser } from './helpers/auth';

// Marco testável da Fase 2 (docs/planning/PRD.md §17): "criar um cliente,
// registrar atividades nele, criar e concluir uma tarefa, e ver tudo
// refletido na timeline e no dashboard" — contra a app real (Postgres via
// Docker Compose), não mocks.
describe('Dashboard flow (e2e)', () => {
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

  it('reflete cliente, atividades e tarefa concluída no dashboard e na timeline', async () => {
    const owner = await registerUser(app, `dashboard-owner-${randomUUID()}@opsmind.test`);
    const auth = { Authorization: `Bearer ${owner.accessToken}` };

    const orgRes = await request(app.getHttpServer())
      .post('/organizations')
      .set(auth)
      .send({ name: 'Dashboard Co', slug: `dashboard-co-${randomUUID()}` })
      .expect(201);
    const organizationId = orgRes.body.id;

    const emptyDashboard = await request(app.getHttpServer())
      .get(`/organizations/${organizationId}/dashboard`)
      .set(auth)
      .expect(200);
    expect(emptyDashboard.body.customers.total).toBe(0);
    expect(emptyDashboard.body.tasks.total).toBe(0);

    const customerRes = await request(app.getHttpServer())
      .post(`/organizations/${organizationId}/customers`)
      .set(auth)
      .send({ name: 'Acme Corp', status: 'ACTIVE' })
      .expect(201);
    const customerId = customerRes.body.id;

    await request(app.getHttpServer())
      .post(`/organizations/${organizationId}/customers/${customerId}/notes`)
      .set(auth)
      .send({ note: 'Reunião de kickoff realizada' })
      .expect(201);

    const taskRes = await request(app.getHttpServer())
      .post(`/organizations/${organizationId}/tasks`)
      .set(auth)
      .send({ title: 'Enviar proposta', customerId })
      .expect(201);
    const taskId = taskRes.body.id;

    await request(app.getHttpServer())
      .patch(`/organizations/${organizationId}/tasks/${taskId}`)
      .set(auth)
      .send({ status: 'DONE' })
      .expect(200);

    const timelineRes = await request(app.getHttpServer())
      .get(`/organizations/${organizationId}/customers/${customerId}/timeline`)
      .set(auth)
      .expect(200);
    const timelineTypes = timelineRes.body.map((a: { type: string }) => a.type);
    expect(timelineTypes).toEqual(expect.arrayContaining(['note.added', 'task.completed']));

    const dashboardRes = await request(app.getHttpServer())
      .get(`/organizations/${organizationId}/dashboard`)
      .set(auth)
      .expect(200);

    expect(dashboardRes.body.customers.total).toBe(1);
    expect(dashboardRes.body.customers.byStatus.ACTIVE).toBe(1);
    expect(dashboardRes.body.tasks.total).toBe(1);
    expect(dashboardRes.body.tasks.byStatus.DONE).toBe(1);
    expect(dashboardRes.body.recentActivity.length).toBeGreaterThanOrEqual(2);
    expect(
      dashboardRes.body.recentActivity.some((a: { type: string }) => a.type === 'task.completed'),
    ).toBe(true);
  });

  it('conta clientes inativos pela regra do PRD §8, não pelo campo status', async () => {
    const owner = await registerUser(app, `dashboard-inactive-owner-${randomUUID()}@opsmind.test`);
    const auth = { Authorization: `Bearer ${owner.accessToken}` };

    const orgRes = await request(app.getHttpServer())
      .post('/organizations')
      .set(auth)
      .send({ name: 'Inactive Co', slug: `inactive-co-${randomUUID()}` })
      .expect(201);
    const organizationId = orgRes.body.id;

    // Cliente novo, sem nenhuma atividade ainda — não conta como "inativo
    // pela regra" (é um LEAD que ainda não começou, não alguém que parou).
    await request(app.getHttpServer())
      .post(`/organizations/${organizationId}/customers`)
      .set(auth)
      .send({ name: 'Lead Novo' })
      .expect(201);

    const dashboardRes = await request(app.getHttpServer())
      .get(`/organizations/${organizationId}/dashboard`)
      .set(auth)
      .expect(200);

    expect(dashboardRes.body.customers.inactiveByRule).toBe(0);
  });
});
