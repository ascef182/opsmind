import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';

function decodeJwtPayload(token: string): { sub: string; email: string } {
  const payload = token.split('.').at(1);
  if (!payload) {
    throw new Error('Token JWT malformado: sem payload');
  }
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

async function registerUser(app: INestApplication, email: string) {
  const res = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password: 'correct horse battery staple', name: 'Org E2E' })
    .expect(201);

  return {
    accessToken: res.body.accessToken as string,
    userId: decodeJwtPayload(res.body.accessToken).sub,
  };
}

// Marco testável do Passo 7 (docs/planning/sprint-1-2-plan.md §4): usuário
// autenticado cria uma organização e vira OWNER — contra a app real
// (Postgres via Docker Compose), não mocks.
describe('Organizations flow (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('cria a organização, vira OWNER e audita a criação', async () => {
    const { accessToken, userId } = await registerUser(app, `org-owner-${randomUUID()}@opsmind.test`);

    const createRes = await request(app.getHttpServer())
      .post('/organizations')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Acme Corp' })
      .expect(201);

    expect(createRes.body.id).toEqual(expect.any(String));
    expect(createRes.body.slug).toBe('acme-corp');

    const membership = await prisma.membership.findFirst({
      where: { organizationId: createRes.body.id, userId },
    });
    expect(membership?.role).toBe('OWNER');

    const auditLog = await prisma.auditLog.findFirst({
      where: { organizationId: createRes.body.id, action: 'organization.created' },
    });
    expect(auditLog?.actorId).toBe(userId);
  });

  it('rejeita criação sem token', async () => {
    await request(app.getHttpServer())
      .post('/organizations')
      .send({ name: 'No Auth Inc' })
      .expect(401);
  });

  it('permite que o OWNER leia a própria organização', async () => {
    const { accessToken } = await registerUser(app, `org-read-${randomUUID()}@opsmind.test`);

    const createRes = await request(app.getHttpServer())
      .post('/organizations')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Readable Org' })
      .expect(201);

    const getRes = await request(app.getHttpServer())
      .get(`/organizations/${createRes.body.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(getRes.body.id).toBe(createRes.body.id);
  });

  it('nega leitura da organização por um usuário que não é membro (404, não confirma existência)', async () => {
    const owner = await registerUser(app, `org-private-${randomUUID()}@opsmind.test`);
    const stranger = await registerUser(app, `org-stranger-${randomUUID()}@opsmind.test`);

    const createRes = await request(app.getHttpServer())
      .post('/organizations')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Private Org' })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/organizations/${createRes.body.id}`)
      .set('Authorization', `Bearer ${stranger.accessToken}`)
      .expect(404);
  });
});
