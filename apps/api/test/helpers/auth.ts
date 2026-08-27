import { INestApplication } from '@nestjs/common';
import request from 'supertest';

/**
 * Extraído depois de aparecer duplicado em auth/organizations/memberships
 * e2e-spec.ts (Fase 1) — usado por todo teste e2e que precisa de um usuário
 * autenticado real, não mockado.
 */
export function decodeJwtPayload(token: string): { sub: string; email: string } {
  const payload = token.split('.').at(1);
  if (!payload) {
    throw new Error('Token JWT malformado: sem payload');
  }
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

export async function registerUser(
  app: INestApplication,
  email: string,
): Promise<{ accessToken: string; userId: string; email: string }> {
  const res = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password: 'correct horse battery staple', name: 'E2E User' })
    .expect(201);

  return {
    accessToken: res.body.accessToken as string,
    userId: decodeJwtPayload(res.body.accessToken).sub,
    email,
  };
}
