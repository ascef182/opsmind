import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import type { LeadStatus, ScrapeSourceType } from '@opsmind/database';

const LEAD_STATUSES: LeadStatus[] = [
  'DISCOVERED',
  'QUALIFIED',
  'DISQUALIFIED',
  'OUTREACH_DRAFTED',
  'OUTREACH_APPROVED',
  'CONTACTED',
  'REPLIED',
  'CONVERTED',
  'LOST',
];

const SCRAPE_SOURCE_TYPES: ScrapeSourceType[] = [
  'APIFY_GOOGLE_MAPS',
  'EXPLORIUM_BUSINESS_SEARCH',
  'CAMOFOX_GOOGLE_SEARCH',
  'CAMOFOX_REDDIT_SEARCH',
  'MANUAL',
];

// `hasWebsite` declarado aqui (em vez de um `@Query('hasWebsite')` avulso
// como em `ServiceOfferingsController.list`) para não colidir com
// `forbidNonWhitelisted: true` do `ValidationPipe` global (main.ts): um
// `@Query()` inteiro validado contra este DTO rejeitaria qualquer chave da
// querystring que o DTO não declare, `hasWebsite` incluso.
export class ListLeadsQueryDto {
  @IsOptional()
  @IsIn(LEAD_STATUSES)
  status?: LeadStatus;

  @IsOptional()
  @IsIn(SCRAPE_SOURCE_TYPES)
  sourceType?: ScrapeSourceType;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  minScore?: number;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  hasWebsite?: boolean;

  // Torna visível/filtrável o problema real que motiva a Task 9: hoje é
  // possível ter dezenas de leads QUALIFIED sem nenhum jeito de contatá-los.
  // Ver `LeadsService.list()` pra construção exata da cláusula (`phone`/
  // `email`/`whatsapp`/`socialLinks`).
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  hasContactMethod?: boolean;

  @IsOptional()
  @IsString()
  search?: string;
}
