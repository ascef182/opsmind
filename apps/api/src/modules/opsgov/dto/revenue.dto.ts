import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsOptional, IsUUID, ValidateIf } from 'class-validator';
import { IsDateKey, IsMonthKey } from '../../finance/dto/validators';
import type { RevenueBasis } from '../revenue-by-activity';

export const MAX_CLASSIFY_BATCH = 500;

export class ClassifyRevenueDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_CLASSIFY_BATCH)
  @IsUUID('all', { each: true })
  entryIds!: string[];

  // null desfaz a classificação.
  @ValidateIf((dto: ClassifyRevenueDto) => dto.companyActivityId !== null)
  @IsUUID()
  companyActivityId!: string | null;
}

export class UnclassifiedQueryDto {
  @IsOptional()
  @IsDateKey()
  from?: string;

  @IsOptional()
  @IsDateKey()
  to?: string;
}

export class RevenueByActivityQueryDto {
  @IsOptional()
  @IsMonthKey()
  from?: string;

  @IsOptional()
  @IsMonthKey()
  to?: string;

  @IsOptional()
  @IsIn(['COMPETENCIA', 'CAIXA'])
  basis?: RevenueBasis;
}

export class Rbt12QueryDto {
  @IsOptional()
  @IsMonthKey()
  month?: string;

  @IsOptional()
  @IsIn(['COMPETENCIA', 'CAIXA'])
  basis?: RevenueBasis;
}
