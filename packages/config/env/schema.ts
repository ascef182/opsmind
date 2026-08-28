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
  // Dono das tabelas — só para `prisma migrate`/seed (packages/database).
  // Nunca deve ser a conexão usada pela API em runtime: essa role bypassa
  // Row-Level Security (docs/planning/reviews/database-reviewer-review.md §1.3).
  DATABASE_URL: z.string().url().startsWith('postgresql://'),
  // Runtime da API — role restrita (sem BYPASSRLS), criada por
  // infra/docker/init/02-app-role.sql. É essa que faz as policies de RLS
  // valerem de verdade; PrismaService (apps/api) conecta com esta, não com
  // DATABASE_URL.
  DATABASE_URL_APP: z.string().url().startsWith('postgresql://'),

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

  // IA (Fase 3) — deliberadamente OPCIONAL, ao contrário de toda outra
  // variável acima: IA é um recurso adicional, não uma dependência do resto
  // da aplicação (Fase 1/2 funcionam inteiramente sem ela). Exigi-la no
  // fail-fast do boot bloquearia a API inteira num ambiente sem chave
  // configurada (ex.: este próprio ambiente de desenvolvimento). A falta da
  // chave só falha, alto e claro, no primeiro uso real do endpoint de IA —
  // ver ClaudeGatewayService.
  ANTHROPIC_API_KEY: z.string().optional(),

  // Observabilidade (Fase 6 — PRD §15: "Sentry + logging estruturado").
  // SENTRY_DSN opcional pelo mesmo motivo de ANTHROPIC_API_KEY: observabilidade
  // é um recurso adicional, não uma dependência — o SDK do Sentry já trata
  // `dsn` ausente/vazio como "desabilitado" silenciosamente (não lança), então
  // dev local sem DSN configurado funciona normalmente, só sem reportar erros.
  SENTRY_DSN: z.string().optional(),
  // Nível mínimo de log emitido (pino) — 'info' em produção evita ruído de
  // 'debug' em disco/agregador de logs; sobrescrito pra 'debug' em dev via
  // .env.example, sem exigir rebuild pra mudar verbosidade.
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
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
