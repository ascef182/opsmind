import { IsNumber, IsOptional, Min } from 'class-validator';

/**
 * `@IsOptional()` do class-validator trata `null` E `undefined` como "pula os
 * outros validadores" — exatamente a semântica que este endpoint precisa:
 * campo omitido = não mexe; `null` = limpa o orçamento (nunca corta, mesma
 * semântica de `BudgetService.isOverBudget`); número = valida e seta.
 *
 * `scrapingMonthlyBudget` (Task 5, leads/prospecção) segue exatamente a
 * mesma validação/serialização Decimal↔number de `aiMonthlyBudget` — os dois
 * orçamentos são independentes (fornecedores de custo distintos: IA vs.
 * scraping) e nunca competem pelo mesmo teto.
 */
export class UpdateOrganizationDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  aiMonthlyBudget?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  scrapingMonthlyBudget?: number | null;
}
