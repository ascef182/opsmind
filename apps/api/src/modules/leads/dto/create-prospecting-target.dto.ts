import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  IsUUID,
} from 'class-validator';
import type { ScrapeSourceType } from '@opsmind/database';
import { AUTOMATABLE_SOURCE_TYPES } from './create-scrape-job.dto';

// Config recorrente de um alvo de prospecção autônoma: o worker (Task 7)
// varre os `ProspectingTarget` ativos e dispara um `ScrapeJob` por alvo
// respeitando `cooldownDays`. `sourceType` exclui `MANUAL` pelo mesmo motivo
// de `CreateScrapeJobDto` — nunca é uma fonte de scraping de verdade.
export class CreateProspectingTargetDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  city!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  state!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  businessType!: string;

  // Default `APIFY_GOOGLE_MAPS` aplicado no service quando ausente, não
  // aqui — mesmo padrão de `onlyWithoutWebsite` em `CreateScrapeJobDto`.
  @IsOptional()
  @IsIn(AUTOMATABLE_SOURCE_TYPES)
  sourceType?: ScrapeSourceType;

  @IsOptional()
  @IsBoolean()
  onlyWithoutWebsite?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(90)
  cooldownDays?: number;

  @IsOptional()
  @IsUUID()
  campaignId?: string;
}
