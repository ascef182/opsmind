import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ACCOUNTING_SCENARIOS, type AccountingScenario } from '@opsmind/shared-types';
import { MAX_AMOUNT_CENTS } from '../../finance/finance.constants';

class ProposalFieldsDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  contactName?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  includes?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;

  @IsOptional()
  @IsUUID()
  documentId?: string;
}

export class CreateProposalDto extends ProposalFieldsDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  firm!: string;

  @IsIn(ACCOUNTING_SCENARIOS as unknown as string[])
  scenario!: AccountingScenario;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_AMOUNT_CENTS)
  setupCents!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_AMOUNT_CENTS)
  monthlyFeeCents!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_AMOUNT_CENTS)
  annualCents?: number;
}

export class UpdateProposalDto extends ProposalFieldsDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  firm?: string;

  @IsOptional()
  @IsIn(ACCOUNTING_SCENARIOS as unknown as string[])
  scenario?: AccountingScenario;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_AMOUNT_CENTS)
  setupCents?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_AMOUNT_CENTS)
  monthlyFeeCents?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_AMOUNT_CENTS)
  annualCents?: number;
}

export class CreateDecisionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  topic!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  question!: string;
}

export class AddAnswerDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(8000)
  text!: string;

  // Quem respondeu (ex.: "Contador — Escritório X"). Padrão: o usuário logado.
  @IsOptional()
  @IsString()
  @MaxLength(200)
  author?: string;
}

export class DecideDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(8000)
  finalDecision!: string;
}

export class DecisionStatusDto {
  @IsIn(['PENDENTE', 'EM_ANALISE'])
  status!: 'PENDENTE' | 'EM_ANALISE';
}
