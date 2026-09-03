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
} from 'class-validator';
import type { ScrapeSourceType } from '@opsmind/database';

// `MANUAL` fica de fora de propósito — não é uma fonte de scraping de
// verdade, é o valor usado quando um Lead é criado à mão via
// `POST .../leads` (ver `LeadsService.create`). Só as 4 fontes automatizáveis
// (que o registry de `apps/worker/src/lead-scrape-processor.ts` sabe
// processar) podem ser disparadas por este endpoint.
const AUTOMATABLE_SOURCE_TYPES: ScrapeSourceType[] = [
  'APIFY_GOOGLE_MAPS',
  'EXPLORIUM_BUSINESS_SEARCH',
  'CAMOFOX_GOOGLE_SEARCH',
  'CAMOFOX_REDDIT_SEARCH',
];

export class CreateScrapeJobDto {
  @IsIn(AUTOMATABLE_SOURCE_TYPES)
  sourceType!: ScrapeSourceType;

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

  // Sinal central do ICP desta feature (PRD da feature): priorizar negócios
  // sem site. Default `true` aplicado no service quando ausente, não aqui —
  // class-validator não expressa "default" de forma nativa no próprio DTO.
  @IsOptional()
  @IsBoolean()
  onlyWithoutWebsite?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
