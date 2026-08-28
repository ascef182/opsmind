import type { Options as PinoHttpOptions } from 'pino-http';
import type { Env } from '@opsmind/config/env/schema';

/**
 * Logging estruturado (PRD §15) — JSON puro em produção (consumível por
 * qualquer agregador de log: Cloud Logging, Datadog, etc.), pino-pretty
 * (legível no terminal) fora dela. `transport` do pino nunca deve rodar em
 * produção mesmo (worker thread extra, sem benefício quando a saída já vai
 * pra um coletor que faz o parsing).
 *
 * `redact`: nunca logar segredo em texto puro — Authorization header e os
 * campos de credencial mais óbvios do corpo de requests de auth. Lista curta
 * de propósito (não uma blocklist genérica que tenta adivinhar todo campo
 * sensível possível); cresce conforme novos endpoints sensíveis aparecerem.
 */
export function buildLoggerOptions(env: Pick<Env, 'NODE_ENV' | 'LOG_LEVEL'>): PinoHttpOptions {
  return {
    level: env.LOG_LEVEL,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.body.password',
        'req.body.refreshToken',
        'req.body.accessToken',
      ],
      censor: '[REDACTED]',
    },
    ...(env.NODE_ENV === 'production'
      ? {}
      : {
          transport: {
            target: 'pino-pretty',
            options: { singleLine: true, translateTime: 'HH:MM:ss' },
          },
        }),
  };
}
