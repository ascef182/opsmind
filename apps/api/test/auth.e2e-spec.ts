import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

// Marco testável do Passo 5 (docs/planning/sprint-1-2-plan.md §4): fluxo
// completo — registrar, logar, chamar rota protegida, dar refresh, dar
// logout (refresh token revogado) — contra a app real (Postgres via Docker
// Compose), não mocks.
describe('Auth flow (e2e)', () => {
  let app: INestApplication;
  const email = `auth-e2e-${randomUUID()}@opsmind.test`;
  const password = 'correct horse battery staple';

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

  it('registra, loga, acessa rota protegida, dá refresh e faz logout', async () => {
    const registerRes = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password, name: 'Auth E2E' })
      .expect(201);

    expect(registerRes.body.accessToken).toEqual(expect.any(String));
    expect(registerRes.body.refreshToken).toEqual(expect.any(String));

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);

    const { accessToken, refreshToken } = loginRes.body;
    expect(accessToken).toEqual(expect.any(String));
    expect(refreshToken).toEqual(expect.any(String));

    await request(app.getHttpServer())
      .get('/auth/me')
      .expect(401);

    const meRes = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(meRes.body.email).toBe(email);

    const refreshRes = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken })
      .expect(200);

    const rotatedRefreshToken = refreshRes.body.refreshToken;
    expect(refreshRes.body.accessToken).toEqual(expect.any(String));
    expect(rotatedRefreshToken).not.toBe(refreshToken);

    // Reuso do refresh token antigo (já rotacionado) deve ser rejeitado —
    // detecção de roubo, não só "token inexistente".
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken })
      .expect(401);

    await request(app.getHttpServer())
      .post('/auth/logout')
      .send({ refreshToken: rotatedRefreshToken })
      .expect(204);

    // Após o logout, o refresh token revogado não pode mais ser usado.
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: rotatedRefreshToken })
      .expect(401);
  });

  it('rejeita registro duplicado com o mesmo email', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password, name: 'Auth E2E' })
      .expect(409);
  });

  it('rejeita login com senha incorreta', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'wrong-password' })
      .expect(401);
  });
});
