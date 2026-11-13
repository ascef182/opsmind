import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import type { ScrapeSourceType } from '@opsmind/database';
import { AUTOMATABLE_SOURCE_TYPES } from './create-scrape-job.dto';

export class ScrapeJobBatchLocationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  city!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  state!: string;
}

// Mesmos campos de `CreateScrapeJobDto`, exceto `city`/`state` — que aqui
// vêm como `locations`, uma por disparo. Resto da config (sourceType,
// businessType, onlyWithoutWebsite, limit) é compartilhado por todo o lote.
export class CreateScrapeJobBatchDto {
  @IsIn(AUTOMATABLE_SOURCE_TYPES)
  sourceType!: ScrapeSourceType;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  businessType!: string;

  @IsOptional()
  @IsBoolean()
  onlyWithoutWebsite?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  // Teto simples contra um lote absurdo disparando centenas de ScrapeJob de
  // uma vez — cada um já tem custo real de orçamento.
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ScrapeJobBatchLocationDto)
  locations!: ScrapeJobBatchLocationDto[];
}
