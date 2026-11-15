import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import type { LeadStatus } from '@opsmind/database';
import { SocialLinkDto } from './social-link.dto';

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

// Atualização manual — status (ex.: marcar LOST) e os campos de contato
// ("contactHandle-equivalentes" do brief: este schema não tem um único
// `contactHandle` genérico como o branch antigo, e sim phone/email/website
// próprios do Lead). Não confundir com as transições automáticas de
// `POST .../score`, que recalculam status a partir de `scoreLead()`.
export class UpdateLeadDto {
  @IsOptional()
  @IsIn(LEAD_STATUSES)
  status?: LeadStatus;

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
  @MaxLength(40)
  whatsapp?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  contactName?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => SocialLinkDto)
  socialLinks?: SocialLinkDto[];
}
