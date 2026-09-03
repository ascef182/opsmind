import { IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

// Entrada manual de um lead (sourceType MANUAL, fixado pelo service — não é
// campo do DTO). As demais origens (APIFY_GOOGLE_MAPS etc.) só chegam via
// `apps/worker/src/lead-scrape-processor.ts`, nunca por este endpoint.
export class CreateLeadDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string;

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
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  website?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  googleCategory?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(5)
  rating?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  reviewCount?: number;

  @IsOptional()
  @IsString()
  rawContent?: string;
}
