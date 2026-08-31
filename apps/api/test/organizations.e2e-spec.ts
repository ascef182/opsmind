import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { registerUser } from './helpers/auth';

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
    const slug = `acme-corp-${randomUUID()}`;

    const createRes = await request(app.getHttpServer())
      .post('/organizations')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Acme Corp', slug })
      .expect(201);

    expect(createRes.body.id).toEqual(expect.any(String));
    expect(createRes.body.slug).toBe(slug);

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
      .send({ name: 'Readable Org', slug: `readable-org-${randomUUID()}` })
      .expect(201);

    const getRes = await request(app.getHttpServer())
      .get(`/organizations/${createRes.body.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(getRes.body.id).toBe(createRes.body.id);
  });

  it('lista só as organizações das quais o usuário é membro', async () => {
    const a = await registerUser(app, `org-list-a-${randomUUID()}@opsmind.test`);
    const b = await registerUser(app, `org-list-b-${randomUUID()}@opsmind.test`);

    const orgRes = await request(app.getHttpServer())
      .post('/organizations')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ name: 'A Co', slug: `a-co-${randomUUID()}` })
      .expect(201);

    const listA = await request(app.getHttpServer())
      .get('/organizations')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .expect(200);
    expect(listA.body.map((org: { id: string }) => org.id)).toContain(orgRes.body.id);

    const listB = await request(app.getHttpServer())
      .get('/organizations')
      .set('Authorization', `Bearer ${b.accessToken}`)
      .expect(200);
    expect(listB.body.map((org: { id: string }) => org.id)).not.toContain(orgRes.body.id);
  });

  it('nega leitura da organização por um usuário que não é membro (404, não confirma existência)', async () => {
    const owner = await registerUser(app, `org-private-${randomUUID()}@opsmind.test`);
    const stranger = await registerUser(app, `org-stranger-${randomUUID()}@opsmind.test`);

    const createRes = await request(app.getHttpServer())
      .post('/organizations')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Private Org', slug: `private-org-${randomUUID()}` })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/organizations/${createRes.body.id}`)
      .set('Authorization', `Bearer ${stranger.accessToken}`)
      .expect(404);
  });

  it('OWNER configura e limpa o orçamento mensal de IA; MEMBER não pode', async () => {
    const { accessToken: ownerToken } = await registerUser(app, `budget-owner-${randomUUID()}@opsmind.test`);
    const orgRes = await request(app.getHttpServer())
      .post('/organizations')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Budget Co', slug: `budget-co-${randomUUID()}` })
      .expect(201);
    const organizationId = orgRes.body.id as string;

    await request(app.getHttpServer())
      .patch(`/organizations/${organizationId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ aiMonthlyBudget: 150 })
      .expect(200);

    const afterSet = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
    expect(Number(afterSet.aiMonthlyBudget)).toBe(150);

    await request(app.getHttpServer())
      .patch(`/organizations/${organizationId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ aiMonthlyBudget: null })
      .expect(200);

    const afterClear = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
    expect(afterClear.aiMonthlyBudget).toBeNull();

    const { userId: memberUserId, accessToken: memberToken } = await registerUser(
      app,
      `budget-member-${randomUUID()}@opsmind.test`,
    );
    await prisma.membership.create({ data: { userId: memberUserId, organizationId, role: 'MEMBER' } });

    await request(app.getHttpServer())
      .patch(`/organizations/${organizationId}`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ aiMonthlyBudget: 999 })
      .expect(403);
  });

  it('rejeita orçamento negativo', async () => {
    const { accessToken } = await registerUser(app, `budget-neg-${randomUUID()}@opsmind.test`);
    const orgRes = await request(app.getHttpServer())
      .post('/organizations')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Budget Neg Co', slug: `budget-neg-co-${randomUUID()}` })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/organizations/${orgRes.body.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ aiMonthlyBudget: -10 })
      .expect(400);
  });
});
