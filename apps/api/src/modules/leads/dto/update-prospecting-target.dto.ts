import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import type { ScrapeSourceType } from '@opsmind/database';
import { AUTOMATABLE_SOURCE_TYPES } from './create-scrape-job.dto';

// Atualização manual — `@nestjs/mapped-types` (PartialType) não é uma
// dependência deste pacote; mesmo padrão de `UpdateServiceOfferingDto`/
// `UpdateLeadDto` (todos os `update-*.dto.ts` do módulo redeclaram os campos
// como opcionais em vez de derivar via PartialType).
export class UpdateProspectingTargetDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  state?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  businessType?: string;

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
