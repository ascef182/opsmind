import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type { OfferingKind } from '@opsmind/shared-types';

const OFFERING_KINDS: OfferingKind[] = ['WEBSITE', 'WHATSAPP_AUTOMATION', 'CUSTOM_APP', 'OTHER'];

export class UpdateServiceOfferingDto {
  // Tipo de produto: `generateDraft` escolhe a oferta pela abordagem do
  // contato (sem site -> WEBSITE; WhatsApp -> WHATSAPP_AUTOMATION).
  @IsOptional()
  @IsIn(OFFERING_KINDS)
  kind?: OfferingKind;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

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

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
