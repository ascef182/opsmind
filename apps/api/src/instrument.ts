// Precisa ser o PRIMEIRO import de todo o processo (ver main.ts) — é assim
// que o SDK do Sentry consegue instrumentar automaticamente os módulos que
// vierem depois. `dsn` ausente/vazio faz o SDK ficar inerte (nenhuma chamada
// de rede, nenhum erro) — SENTRY_DSN é opcional no schema de env pelo mesmo
// motivo de ANTHROPIC_API_KEY: observabilidade é um recurso adicional, dev
// local não deveria precisar de uma conta Sentry pra rodar a API.
import * as Sentry from '@sentry/nestjs';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  // 100% em dev/staging seria caro e desnecessário em produção real — 10%
  // já dá visibilidade de performance sem gerar volume de evento excessivo
  // pra um projeto deste porte.
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
});
