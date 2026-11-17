import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
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
  @IsIn(['ACTIVE', 'ARCHIVED'])
  status?: 'ACTIVE' | 'ARCHIVED';

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

export class CreateCampaignDto extends UpdateCampaignDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  declare name: string;

  @Matches(/^[A-Z]{2}$/)
  declare country: string;

  @Matches(/^[a-z]{2}(-[A-Z]{2})?$/)
  declare language: string;

  @IsString()
  @MaxLength(64)
  declare timezone: string;
}
