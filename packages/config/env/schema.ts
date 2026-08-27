import { z } from 'zod';

/**
 * Validação de variáveis de ambiente da API.
 * Falha alto e cedo (na subida da app) com mensagem clara nomeando a variável
 * faltante/inválida, em vez de deixar `undefined` vazar para dentro da aplicação.
 *
 * Fase 1: apenas Database, Redis (conexão reservada, ainda ociosa até a Fase 5),
 * Auth e API. Novas seções (AI, Storage) são adicionadas conforme as fases que as
 * introduzem, sem quebrar o que já está validado.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // Database
  DATABASE_URL: z.string().url().startsWith('postgresql://'),

  // Redis (BullMQ workers chegam na Fase 5; conexão já validada desde já)
  REDIS_URL: z.string().url().startsWith('redis://'),

  // Auth
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET deve ter pelo menos 32 caracteres'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET deve ter pelo menos 32 caracteres'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),

  // API
  PORT: z.coerce.number().int().positive().default(3000),
  CORS_ORIGIN: z.string().default('http://localhost:3001'),

  // Email
  EMAIL_PROVIDER: z.enum(['console', 'resend']).default('console'),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Valida `process.env` contra o schema acima. Lança um erro legível (lista todas
 * as variáveis inválidas de uma vez, não uma por vez) se algo estiver faltando
 * ou mal formatado — usado no bootstrap do NestJS antes de qualquer módulo subir.
 */
export function validateEnv(raw: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Variáveis de ambiente inválidas:\n${issues}`);
  }
  return result.data;
}
