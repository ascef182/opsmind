import { IsNumber, IsOptional, Min } from 'class-validator';

/**
 * `@IsOptional()` do class-validator trata `null` E `undefined` como "pula os
 * outros validadores" — exatamente a semântica que este endpoint precisa:
 * campo omitido = não mexe; `null` = limpa o orçamento (nunca corta, mesma
 * semântica de `BudgetService.isOverBudget`); número = valida e seta.
 */
export class UpdateOrganizationDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  aiMonthlyBudget?: number | null;
}
