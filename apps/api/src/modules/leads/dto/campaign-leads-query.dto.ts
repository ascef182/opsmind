import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { LEAD_ENTITY_TYPES } from '@opsmind/shared-types';

const LEAD_STATUSES = [
  'DISCOVERED',
  'QUALIFIED',
  'DISQUALIFIED',
  'OUTREACH_DRAFTED',
  'OUTREACH_APPROVED',
  'CONTACTED',
  'REPLIED',
  'CONVERTED',
  'LOST',
] as const;

export const CAMPAIGN_LEAD_SORTS = ['score', 'discoveredAt', 'name', 'lastFoundAt'] as const;

export class CampaignLeadsQueryDto {
  @IsOptional()
  @IsIn(LEAD_STATUSES)
  status?: (typeof LEAD_STATUSES)[number];

  // "qualified" = passou da qualificação (qualquer status depois de QUALIFIED).
  @IsOptional()
  @IsIn(['qualified', 'disqualified', 'pending'])
  qualification?: 'qualified' | 'disqualified' | 'pending';

  @IsOptional()
  @IsIn(LEAD_ENTITY_TYPES)
  entityType?: (typeof LEAD_ENTITY_TYPES)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  minScore?: number;

  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  hasWebsite?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @IsIn(CAMPAIGN_LEAD_SORTS)
  sort?: (typeof CAMPAIGN_LEAD_SORTS)[number];

  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';

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

export class CampaignMessagesQueryDto {
  @IsOptional()
  @IsIn(['DRAFT', 'APPROVED', 'SENDING', 'SEND_UNKNOWN', 'SENT', 'REPLIED', 'REJECTED'])
  status?: 'DRAFT' | 'APPROVED' | 'SENDING' | 'SEND_UNKNOWN' | 'SENT' | 'REPLIED' | 'REJECTED';

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

export class DuplicateCandidatesQueryDto {
  @IsOptional()
  @IsIn(['PENDING', 'CONFIRMED', 'DISMISSED'])
  status?: 'PENDING' | 'CONFIRMED' | 'DISMISSED';

  @IsOptional()
  @IsString()
  campaignId?: string;
}
