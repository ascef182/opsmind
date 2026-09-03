import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

// `signals`/`targetIndustries` viram diretamente input de `ServiceOfferingIcp`
// (packages/shared-types/src/lead-scoring.ts) — `signals` alimenta o fallback
// de keyword-match (fontes não-estruturadas) e `targetIndustries` +
// min/max Employees/RevenueUsd alimentam o fit de ICP (fontes estruturadas).
export class CreateServiceOfferingDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(30)
  signals?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(30)
  targetIndustries?: string[];

  @IsOptional()
  @IsInt()
  @Min(0)
  minEmployees?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxEmployees?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  minRevenueUsd?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000_000_000)
  maxRevenueUsd?: number;
}
