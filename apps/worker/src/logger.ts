import pino, { type Logger } from 'pino';
import type { Env } from '@opsmind/config/env/schema';

/**
 * Logging estruturado (PRD §15) — mesmo espírito de
 * apps/api/src/infrastructure/logging/logger-options.ts, mas mais simples:
 * sem pino-http (não há requests HTTP aqui), sem `redact` (o worker nunca
 * loga headers/corpo de request — os jobs que processa não carregam
 * segredo nenhum, só IDs). `service: 'opsmind-worker'` distingue estes logs
 * dos da API no mesmo agregador (Cloud Logging etc.), já que os dois
 * processos rodam lado a lado em produção.
 */
export function createLogger(env: Pick<Env, 'NODE_ENV' | 'LOG_LEVEL'>): Logger {
  return pino({
    level: env.LOG_LEVEL,
    base: { service: 'opsmind-worker' },
    ...(env.NODE_ENV === 'production'
      ? {}
      : {
          transport: {
            target: 'pino-pretty',
            options: { singleLine: true, translateTime: 'HH:MM:ss' },
          },
        }),
  });
}
