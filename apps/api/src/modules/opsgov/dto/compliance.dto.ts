import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import {
  CERTIFICATE_TYPES,
  COMPLIANCE_OBLIGATION_TYPES,
  OBLIGATION_RECURRENCES,
  type CertificateType,
  type ComplianceObligationType,
  type ObligationRecurrence,
} from '@opsmind/shared-types';
import { IsDateKey } from '../../finance/dto/validators';

export class CreateObligationDto {
  @IsIn(COMPLIANCE_OBLIGATION_TYPES as unknown as string[])
  type!: ComplianceObligationType;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @IsIn(OBLIGATION_RECURRENCES as unknown as string[])
  recurrence!: ObligationRecurrence;

  // MONTHLY/YEARLY: dia do vencimento. ONCE: ignorado.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(31)
  dueDay?: number;

  // YEARLY: mês do vencimento.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  dueMonth?: number;

  // Primeiro vencimento (obrigatório para ONCE; nos recorrentes, se omitido,
  // é calculado a partir de hoje pela regra).
  @IsOptional()
  @IsDateKey()
  firstDueDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class UpdateObligationDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  // Reagendar o vencimento atual (ex.: prorrogação oficial).
  @IsOptional()
  @IsDateKey()
  nextDueDate?: string;
}

export class CompleteObligationDto {
  @IsOptional()
  @IsDateKey()
  completedOn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsUUID()
  documentId?: string;
}

export class DismissObligationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}

export class CreateCertificateDto {
  @IsIn(CERTIFICATE_TYPES as unknown as string[])
  type!: CertificateType;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  issuer?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  code?: string;

  @IsDateKey()
  issuedOn!: string;

  @IsDateKey()
  validUntil!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsUUID()
  documentId?: string;
}

export class UpdateCertificateDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsUUID()
  documentId?: string;
}
