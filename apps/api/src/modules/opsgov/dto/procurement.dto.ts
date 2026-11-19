import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  CERTIFICATE_TYPES,
  INCOME_CATEGORIES,
  PROCUREMENT_MODALITIES,
  PROCUREMENT_REQUIREMENT_TYPES,
  PROCUREMENT_STATUSES,
  type CertificateType,
  type IncomeCategory,
  type ProcurementModality,
  type ProcurementRequirementType,
  type ProcurementStatus,
} from '@opsmind/shared-types';
import { MAX_AMOUNT_CENTS } from '../../finance/finance.constants';
import { IsDateKey } from '../../finance/dto/validators';

export class CreateTechnicalCertificateDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  issuer!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  object!: string;

  @IsDateKey()
  periodStart!: string;

  @IsOptional()
  @IsDateKey()
  periodEnd?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_AMOUNT_CENTS)
  valueCents?: number;

  @IsOptional()
  @IsUUID()
  companyActivityId?: string;

  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsUUID()
  contractId?: string;

  @IsOptional()
  @IsUUID()
  documentId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

// Emissor, objeto, período e valor são o que o atestado diz: não mudam.
// Atestado errado se registra de novo; aqui só vínculos e anotações.
export class UpdateTechnicalCertificateDto {
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  companyActivityId?: string | null;

  @IsOptional()
  @IsUUID()
  documentId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class CreateOpportunityDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  agency!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  agencyCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  processNumber?: string;

  @IsIn(PROCUREMENT_MODALITIES as unknown as string[])
  modality!: ProcurementModality;

  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  object!: string;

  @IsOptional()
  @IsUrl({ protocols: ['https', 'http'], require_protocol: true })
  @MaxLength(1000)
  editalUrl?: string;

  @IsOptional()
  @IsDateKey()
  sessionDate?: string;

  @IsOptional()
  @IsDateKey()
  proposalDeadline?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_AMOUNT_CENTS)
  estimatedValueCents?: number;

  @IsOptional()
  @IsUUID()
  editalDocumentId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;
}

// null limpa o campo; ausente mantém.
export class UpdateOpportunityDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  agency?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(40)
  agencyCode?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(80)
  processNumber?: string | null;

  @IsOptional()
  @IsIn(PROCUREMENT_MODALITIES as unknown as string[])
  modality?: ProcurementModality;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  object?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUrl({ protocols: ['https', 'http'], require_protocol: true })
  @MaxLength(1000)
  editalUrl?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsDateKey()
  sessionDate?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsDateKey()
  proposalDeadline?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_AMOUNT_CENTS)
  estimatedValueCents?: number | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  editalDocumentId?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(4000)
  notes?: string | null;
}

export class ChangeOpportunityStatusDto {
  @IsIn(PROCUREMENT_STATUSES as unknown as string[])
  status!: ProcurementStatus;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}

export class CreateRequirementDto {
  @IsIn(PROCUREMENT_REQUIREMENT_TYPES as unknown as string[])
  type!: ProcurementRequirementType;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  description!: string;

  @IsOptional()
  @IsIn(CERTIFICATE_TYPES as unknown as string[])
  certificateType?: CertificateType;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  requiredCnae?: string;

  @IsOptional()
  @IsUUID()
  technicalCertificateId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class UpdateRequirementDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsIn(CERTIFICATE_TYPES as unknown as string[])
  certificateType?: CertificateType;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  requiredCnae?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  technicalCertificateId?: string | null;

  @IsOptional()
  @IsBoolean()
  manuallyMet?: boolean;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  documentId?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

export class ConvertOpportunityDto {
  // Cliente existente; sem ele, um cliente novo é criado com o nome do órgão.
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsIn(INCOME_CATEGORIES as unknown as string[])
  category?: IncomeCategory;

  @IsIn(['ONE_TIME', 'MONTHLY'])
  billing!: 'ONE_TIME' | 'MONTHLY';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_AMOUNT_CENTS)
  valueCents!: number;

  @IsDateKey()
  startDate!: string;

  @IsOptional()
  @IsDateKey()
  endDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(31)
  billingDay?: number;

  @IsOptional()
  @IsDateKey()
  firstDueDate?: string;

  @IsOptional()
  @IsBoolean()
  generateBilling?: boolean;
}
