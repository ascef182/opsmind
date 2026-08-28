// Precisa ser o PRIMEIRO import de todo o processo (ver main.ts) — mesmo
// motivo de apps/api/src/instrument.ts. `dsn` ausente/vazio deixa o SDK
// inerte; SENTRY_DSN é opcional no schema de env.
import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
});
