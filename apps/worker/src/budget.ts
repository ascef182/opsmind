import type Redis from 'ioredis';

// ~35 dias: cobre o mês inteiro mais uma folga de fuso horário, sem deixar
// chaves de meses antigos acumulando pra sempre no Redis. Mesmo valor de
// `apps/api/src/modules/ai/services/budget.service.ts`.
const BUDGET_KEY_TTL_SECONDS = 35 * 24 * 60 * 60;

/**
 * Corte de orçamento de scraping — versão framework-free do que
 * `BudgetService` (apps/api, IA) faz, com `kind: 'scraping'` fixo em vez de
 * 'ai-budget'. `apps/worker` não tem DI do Nest nem pode importar
 * `BudgetService` de `apps/api` (processos deployáveis separados), então o
 * mesmo padrão — contador Redis por organização/mês via `incrbyfloat`,
 * TTL definido só na primeira escrita do mês via `expire ... NX` — é
 * replicado aqui como funções puras (Redis injetado), em vez de uma classe
 * com `@Injectable()`.
 *
 * Comparado contra `Organization.scrapingMonthlyBudget` antes de cada
 * `ScrapeJob` rodar (ver `lead-scrape-processor.ts`, passo 2).
 */

function monthKey(organizationId: string): string {
  const now = new Date();
  const yearMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  return `scraping-budget:${organizationId}:${yearMonth}`;
}

export async function getMonthSpend(redis: Redis, organizationId: string): Promise<number> {
  const value = await redis.get(monthKey(organizationId));
  return value ? Number(value) : 0;
}

/** `monthlyBudget` nulo = organização sem orçamento de scraping configurado, nunca corta. */
export async function isOverBudget(
  redis: Redis,
  organizationId: string,
  monthlyBudget: number | null,
): Promise<boolean> {
  if (monthlyBudget === null) {
    return false;
  }
  const spend = await getMonthSpend(redis, organizationId);
  return spend >= monthlyBudget;
}

export async function recordSpend(redis: Redis, organizationId: string, cost: number): Promise<void> {
  const key = monthKey(organizationId);
  await redis.incrbyfloat(key, cost);
  // NX: só define TTL na primeira escrita do mês — incrementos seguintes não
  // devem "adiar" a expiração da chave.
  await redis.expire(key, BUDGET_KEY_TTL_SECONDS, 'NX');
}
