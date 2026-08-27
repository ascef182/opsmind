import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { registerUser } from './helpers/auth';

/** Extrai o token bruto do convite logado pelo ConsoleEmailProvider (dev). */
function extractInvitationToken(logSpy: jest.SpyInstance): string {
  const logged = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');
  const token = /token: (\S+)/.exec(logged)?.at(1);
  if (!token) {
    throw new Error(`Token de convite não encontrado no log: ${logged}`);
  }
  return token;
}

// Marco testável do Passo 9 — fecha o critério de aceitação da Fase 1 por
// completo (docs/planning/sprint-1-2-plan.md §4): A cria org → convida B como
// MEMBER → B aceita → GET /organizations/:id/members mostra os dois →
// GET /organizations/:id/audit-logs mostra tudo. Contra a app real
// (Postgres via Docker Compose), não mocks.
describe('Memberships flow (e2e)', () => {
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

  it('A cria org, convida B, B aceita, members e audit-logs mostram tudo', async () => {
    const a = await registerUser(app, `member-a-${randomUUID()}@opsmind.test`);
    const b = await registerUser(app, `member-b-${randomUUID()}@opsmind.test`);

    const orgRes = await request(app.getHttpServer())
      .post('/organizations')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ name: 'Membership Co', slug: `membership-co-${randomUUID()}` })
      .expect(201);
    const organizationId = orgRes.body.id;

    const logSpy = jest.spyOn(console, 'log').mockImplementation();
    await request(app.getHttpServer())
      .post(`/organizations/${organizationId}/invite`)
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ email: b.email, role: 'MEMBER' })
      .expect(201);
    const invitationToken = extractInvitationToken(logSpy);
    logSpy.mockRestore();

    await request(app.getHttpServer())
      .post(`/invitations/${invitationToken}/accept`)
      .set('Authorization', `Bearer ${b.accessToken}`)
      .expect(201);

    const membersRes = await request(app.getHttpServer())
      .get(`/organizations/${organizationId}/members`)
      .set('Authorization', `Bearer ${a.accessToken}`)
      .expect(200);

    expect(membersRes.body).toHaveLength(2);
    const roles = membersRes.body.map((m: { role: string; user: { email: string } }) => ({
      role: m.role,
      email: m.user.email,
    }));
    expect(roles).toEqual(
      expect.arrayContaining([
        { role: 'OWNER', email: a.email },
        { role: 'MEMBER', email: b.email },
      ]),
    );

    const auditRes = await request(app.getHttpServer())
      .get(`/organizations/${organizationId}/audit-logs`)
      .set('Authorization', `Bearer ${a.accessToken}`)
      .expect(200);

    const actions = auditRes.body.map((log: { action: string }) => log.action);
    expect(actions).toEqual(
      expect.arrayContaining(['organization.created', 'membership.invited', 'membership.accepted']),
    );
  });

  it('rejeita convite feito por quem não é OWNER/ADMIN', async () => {
    const owner = await registerUser(app, `perm-owner-${randomUUID()}@opsmind.test`);
    const member = await registerUser(app, `perm-member-${randomUUID()}@opsmind.test`);
    const stranger = await registerUser(app, `perm-stranger-${randomUUID()}@opsmind.test`);

    const orgRes = await request(app.getHttpServer())
      .post('/organizations')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Perm Co', slug: `perm-co-${randomUUID()}` })
      .expect(201);
    const organizationId = orgRes.body.id;

    const logSpy = jest.spyOn(console, 'log').mockImplementation();
    await request(app.getHttpServer())
      .post(`/organizations/${organizationId}/invite`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ email: member.email, role: 'MEMBER' })
      .expect(201);
    const invitationToken = extractInvitationToken(logSpy);
    logSpy.mockRestore();

    await request(app.getHttpServer())
      .post(`/invitations/${invitationToken}/accept`)
      .set('Authorization', `Bearer ${member.accessToken}`)
      .expect(201);

    // MEMBER não pode convidar (RolesGuard exige OWNER/ADMIN).
    await request(app.getHttpServer())
      .post(`/organizations/${organizationId}/invite`)
      .set('Authorization', `Bearer ${member.accessToken}`)
      .send({ email: 'someone@opsmind.test', role: 'VIEWER' })
      .expect(403);

    // Quem não é membro nem chega a essa checagem — barrado pelo TenantGuard.
    await request(app.getHttpServer())
      .get(`/organizations/${organizationId}/members`)
      .set('Authorization', `Bearer ${stranger.accessToken}`)
      .expect(403);
  });

  it('rejeita aceitar convite com o email de outra pessoa', async () => {
    const owner = await registerUser(app, `mismatch-owner-${randomUUID()}@opsmind.test`);
    const invited = await registerUser(app, `mismatch-invited-${randomUUID()}@opsmind.test`);
    const wrongUser = await registerUser(app, `mismatch-wrong-${randomUUID()}@opsmind.test`);

    const orgRes = await request(app.getHttpServer())
      .post('/organizations')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Mismatch Co', slug: `mismatch-co-${randomUUID()}` })
      .expect(201);

    const logSpy = jest.spyOn(console, 'log').mockImplementation();
    await request(app.getHttpServer())
      .post(`/organizations/${orgRes.body.id}/invite`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ email: invited.email, role: 'MEMBER' })
      .expect(201);
    const invitationToken = extractInvitationToken(logSpy);
    logSpy.mockRestore();

    await request(app.getHttpServer())
      .post(`/invitations/${invitationToken}/accept`)
      .set('Authorization', `Bearer ${wrongUser.accessToken}`)
      .expect(403);
  });
});
