import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

const OUTREACH_CHANNELS = ['EMAIL', 'PHONE', 'WHATSAPP', 'LINKEDIN_DM', 'REDDIT_DM', 'INSTAGRAM_DM', 'OTHER'] as const;

// Campo omitido = não mexe. Fuso e janela de horário são validados no service
// (dependem de mais de um campo).
export class UpdateCampaignDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @Matches(/^[A-Z]{2}$/)
  country?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(80)
  regionLabel?: string | null;

  @IsOptional()
  @Matches(/^[a-z]{2}(-[A-Z]{2})?$/)
  language?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  workingDays?: number[];

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1439)
  workStartMinute?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1440)
  workEndMinute?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  dailyResearchGoal?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  dailyQualifiedGoal?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  dailyOutreachGoal?: number;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(OUTREACH_CHANNELS, { each: true })
  enabledChannels?: (typeof OUTREACH_CHANNELS)[number][];

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100000)
  monthlyBudgetUsd?: number | null;
}

const SEARCH_SOURCES = ['APIFY_GOOGLE_MAPS', 'EXPLORIUM_BUSINESS_SEARCH', 'CAMOFOX_GOOGLE_SEARCH', 'CAMOFOX_REDDIT_SEARCH'] as const;

// Segmento + cidade + estado identificam a campanha e não mudam depois.
// Configuração do Harvey omitida = copiada da campanha mais recente.
export class CreateCampaignDto extends UpdateCampaignDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  segment!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  city!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  state!: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(4)
  @IsIn(SEARCH_SOURCES, { each: true })
  sources?: (typeof SEARCH_SOURCES)[number][];
}

export const CAMPAIGN_LIFECYCLE_ACTIONS = ['pause', 'resume', 'complete', 'reopen', 'archive'] as const;

export class CampaignOverviewQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  segment?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED'])
  status?: 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'ARCHIVED';

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  includeArchived?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
