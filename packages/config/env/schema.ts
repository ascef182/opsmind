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
  // Eval suite de IA (Fase 7) — permite ao script `pnpm --filter api eval`
  // usar claude-sonnet-5 (mais barato, ainda suporta thinking adaptativo)
  // sem tocar em código; produção continua em claude-opus-5 por default.
  ANTHROPIC_MODEL: z.string().default('claude-opus-5'),

  // Documentos + RAG (Fase 4) — embeddings via OpenAI (Anthropic não tem
  // endpoint de embeddings; PRD §16 já lista "OpenAI/Anthropic" lado a lado
  // no AI Gateway). Mesma filosofia do ANTHROPIC_API_KEY: opcional, falha
  // alto e claro só no primeiro upload de documento — ver OpenAiEmbeddingGateway.
  OPENAI_API_KEY: z.string().optional(),

  // Storage de arquivos: PRD §16 decide Google Cloud Storage pra produção,
  // mas dev/CI não tem (nem deveria precisar de) um bucket real — mesmo
  // espírito de EMAIL_PROVIDER (console local vs. Resend real). `local`
  // grava em disco (LocalStorageService); `gcs` fica para quando o deploy
  // em GCP acontecer (Fase 6).
  STORAGE_PROVIDER: z.enum(['local', 'gcs']).default('local'),
  // Só usado quando STORAGE_PROVIDER=local. Caminho relativo à raiz do
  // monorepo por padrão — fora de qualquer pasta versionada (.gitignore).
  LOCAL_STORAGE_DIR: z.string().default('.data/uploads'),

  // Leads / prospecção (branch feat/leads-prospecting) — três integrações
  // externas plugáveis por `ScrapeJob.sourceType`, todas OPCIONAIS, mesmo
  // espírito de ANTHROPIC_API_KEY: nenhuma delas é dependência do resto da
  // aplicação (Fase 1/2 e o restante do produto funcionam sem a feature de
  // leads). Cada uma falha alto e claro só no primeiro scrape que a usa —
  // ver os gateways em packages/integrations.
  // Apify (actor de Google Maps — dados estruturados: telefone/rating/site/
  // categoria). Sem o token, ScrapeJob com sourceType=APIFY_GOOGLE_MAPS
  // falha ao disparar; outras fontes continuam funcionando normalmente.
  APIFY_API_TOKEN: z.string().optional(),
  // Id do actor Apify usado para a busca — tem default porque é o mesmo
  // actor público pra qualquer organização (não é segredo, só configuração),
  // ao contrário do token acima; existe como env var em vez de constante
  // hardcoded só pra permitir apontar pra uma versão/fork do actor sem
  // rebuild.
  APIFY_GOOGLE_MAPS_ACTOR_ID: z.string().default('compass/google-maps-extractor'),
  // Explorium (mesma API por trás das tools MCP "Vibe Prospecting" — busca +
  // enrichment B2B com firmografia). Opcional pelo mesmo motivo do token
  // Apify acima: só bloqueia ScrapeJob com sourceType=EXPLORIUM_BUSINESS_SEARCH.
  EXPLORIUM_API_KEY: z.string().optional(),
  // camofox-browser (navegador stealth self-hosted, https://github.com/jo-inc/camofox-browser)
  // — cobertura ampla via macros (@google_search/@yelp_search/@reddit_search)
  // quando não há API estruturada pra fonte desejada. URL do serviço
  // self-hosted; opcional pelo mesmo motivo das outras duas acima.
  CAMOFOX_API_URL: z.string().url().optional(),
  // Chave de acesso do camofox-browser self-hosted. Só faz sentido em par
  // com CAMOFOX_API_URL; validada aqui sem exigir a outra porque o Zod
  // schema não expressa "obrigatório junto" facilmente — o gateway
  // (packages/integrations) que checa a combinação no primeiro uso real.
  CAMOFOX_ACCESS_KEY: z.string().optional(),
  // Intervalo (ms) do scan automático de `ProspectingTarget`s ativos
  // (apps/worker/src/prospecting-scan.ts + main.ts) — mesmo padrão de
  // "scan periódico via setInterval" de `scanCustomerInactiveAutomations`,
  // mas configurável por ambiente (default 1 dia) porque cada `ScrapeJob`
  // automático tem custo real de orçamento de scraping, ao contrário do
  // scan de automations.
  PROSPECTING_SCAN_INTERVAL_MS: z.coerce.number().int().positive().default(86_400_000),

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
