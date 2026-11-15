import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { IsDateKey, IsMonthKey } from './validators';

// Período do overview: um mês ('2026-11') ou um intervalo explícito. Sem nada,
// vale o mês corrente.
export class OverviewQueryDto {
  @IsOptional()
  @IsMonthKey()
  month?: string;

  @IsOptional()
  @IsDateKey()
  from?: string;

  @IsOptional()
  @IsDateKey()
  to?: string;
}

export class YearQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number;
}

export class ProfitabilityQueryDto extends OverviewQueryDto {
  @IsOptional()
  @IsIn(['customer', 'contract'])
  by?: 'customer' | 'contract';
}
