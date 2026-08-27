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
    .send({ name: 'Customers Co', slug: `customers-co-${randomUUID()}` })
    .expect(201);
  return res.body.id as string;
}

// Fase 2 (docs/planning/PRD.md §17): CRUD de Customers com tags/status,
// timeline de atividade. Contra a app real (Postgres via Docker Compose).
describe('Customers flow (e2e)', () => {
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

  it('cria, lista, lê, atualiza, anota (timeline) e exclui (soft-delete) um cliente', async () => {
    const owner = await registerUser(app, `customers-owner-${randomUUID()}@opsmind.test`);
    const organizationId = await createOrg(app, owner.accessToken);
    const auth = { Authorization: `Bearer ${owner.accessToken}` };

    const createRes = await request(app.getHttpServer())
      .post(`/organizations/${organizationId}/customers`)
      .set(auth)
      .send({ name: 'Acme Corp', status: 'LEAD', tags: ['saas'] })
      .expect(201);
    const customerId = createRes.body.id;
    expect(createRes.body.lastActivityAt).toBeNull();

    await request(app.getHttpServer())
      .get(`/organizations/${organizationId}/customers`)
      .set(auth)
      .expect(200)
      .expect((res) => {
        expect(res.body.some((c: { id: string }) => c.id === customerId)).toBe(true);
      });

    await request(app.getHttpServer())
      .patch(`/organizations/${organizationId}/customers/${customerId}`)
      .set(auth)
      .send({ status: 'ACTIVE' })
      .expect(200)
      .expect((res) => {
        expect(res.body.status).toBe('ACTIVE');
      });

    await request(app.getHttpServer())
      .post(`/organizations/${organizationId}/customers/${customerId}/notes`)
      .set(auth)
      .send({ note: 'Primeira ligação — interessado em upgrade' })
      .expect(201);

    const timelineRes = await request(app.getHttpServer())
      .get(`/organizations/${organizationId}/customers/${customerId}/timeline`)
      .set(auth)
      .expect(200);
    expect(timelineRes.body).toHaveLength(1);
    expect(timelineRes.body[0].type).toBe('note.added');

    // lastActivityAt precisa refletir a nota registrada (regra do PRD §8).
    const afterNoteRes = await request(app.getHttpServer())
      .get(`/organizations/${organizationId}/customers/${customerId}`)
      .set(auth)
      .expect(200);
    expect(afterNoteRes.body.lastActivityAt).not.toBeNull();

    await request(app.getHttpServer())
      .delete(`/organizations/${organizationId}/customers/${customerId}`)
      .set(auth)
      .expect(204);

    // Soft-delete: não aparece mais em GET direto nem na listagem.
    await request(app.getHttpServer())
      .get(`/organizations/${organizationId}/customers/${customerId}`)
      .set(auth)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/organizations/${organizationId}/customers`)
      .set(auth)
      .expect(200)
      .expect((res) => {
        expect(res.body.some((c: { id: string }) => c.id === customerId)).toBe(false);
      });
  });

  it('rejeita escrita de VIEWER, mas permite leitura', async () => {
    const owner = await registerUser(app, `customers-perm-owner-${randomUUID()}@opsmind.test`);
    const viewer = await registerUser(app, `customers-perm-viewer-${randomUUID()}@opsmind.test`);
    const organizationId = await createOrg(app, owner.accessToken);

    const logSpy = jest.spyOn(console, 'log').mockImplementation();
    await request(app.getHttpServer())
      .post(`/organizations/${organizationId}/invite`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ email: viewer.email, role: 'VIEWER' })
      .expect(201);
    const token = /token: (\S+)/.exec(logSpy.mock.calls.map((c) => c.join(' ')).join('\n'))?.at(1);
    logSpy.mockRestore();
    await request(app.getHttpServer())
      .post(`/invitations/${token}/accept`)
      .set('Authorization', `Bearer ${viewer.accessToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .post(`/organizations/${organizationId}/customers`)
      .set('Authorization', `Bearer ${viewer.accessToken}`)
      .send({ name: 'Should Fail' })
      .expect(403);

    await request(app.getHttpServer())
      .get(`/organizations/${organizationId}/customers`)
      .set('Authorization', `Bearer ${viewer.accessToken}`)
      .expect(200);
  });
});
