import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

// Teto do faturamento mensal: R$ 4,8 mi / 12 (acima disso não há Simples).
const MAX_MONTHLY_CENTS = 40_000_000;

export class SimulationQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_MONTHLY_CENTS)
  faturamentoMensalCents!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_MONTHLY_CENTS)
  folhaMensalCents?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  inssSocioRateBp?: number;
}

export class RealSimulationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_MONTHLY_CENTS)
  folhaMensalCents?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  inssSocioRateBp?: number;
}
