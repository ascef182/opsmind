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

  // Sem precedente exato de limite em outro campo de texto livre deste DTO
  // (os demais são campos curtos de cadastro, não texto livre) — 10_000
  // chars é generoso o bastante pra qualquer descrição de negócio real, mas
  // limita o quanto um `rawContent` criado manualmente pode inflar os
  // prompts de IA que o consomem diretamente (`OutreachService`,
  // `LeadAnalysisService` — ver `apps/api/src/modules/leads/outreach.service.ts`
  // e `lead-analysis.service.ts`), evitando custo/latência desproporcional
  // vindo de um único lead cadastrado manualmente.
  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  rawContent?: string;
}
