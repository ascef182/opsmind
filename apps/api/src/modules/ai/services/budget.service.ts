import { Injectable } from '@nestjs/common';
import { RedisService } from '../../../infrastructure/redis/redis.service';

// ~35 dias: cobre o mês inteiro mais uma folga de fuso horário, sem deixar
// chaves de meses antigos acumulando pra sempre no Redis.
const BUDGET_KEY_TTL_SECONDS = 35 * 24 * 60 * 60;

/**
 * Corte de orçamento de IA (decisão confirmada — sprint-1-2-plan.md §7):
 * contador Redis por organização/mês, comparado a `Organization
 * .aiMonthlyBudget` antes de cada chamada à IA. Síncrono e simples de
 * propósito — o painel de alertas completo (Fase 7) fica para depois.
 */
@Injectable()
export class BudgetService {
  constructor(private readonly redis: RedisService) {}

  async getMonthSpend(organizationId: string): Promise<number> {
    const value = await this.redis.get(this.monthKey(organizationId));
    return value ? Number(value) : 0;
  }

  /** `monthlyBudget` nulo = organização sem orçamento configurado, nunca corta. */
  async isOverBudget(organizationId: string, monthlyBudget: number | null): Promise<boolean> {
    if (monthlyBudget === null) {
      return false;
    }
    const spend = await this.getMonthSpend(organizationId);
    return spend >= monthlyBudget;
  }

  async recordSpend(organizationId: string, cost: number): Promise<void> {
    const key = this.monthKey(organizationId);
    await this.redis.incrbyfloat(key, cost);
    // NX: só define TTL na primeira escrita do mês — incrementos seguintes
    // não devem "adiar" a expiração da chave.
    await this.redis.expire(key, BUDGET_KEY_TTL_SECONDS, 'NX');
  }

  private monthKey(organizationId: string): string {
    const now = new Date();
    const yearMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    return `ai-budget:${organizationId}:${yearMonth}`;
  }
}
