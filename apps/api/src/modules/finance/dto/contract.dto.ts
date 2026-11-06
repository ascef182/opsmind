import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { INCOME_CATEGORIES, type IncomeCategory } from '@opsmind/shared-types';
import { MAX_AMOUNT_CENTS } from '../finance.constants';
import { IsDateKey } from './validators';

export class CreateContractDto {
  @IsUUID()
  customerId!: string;

  @IsOptional()
  @IsUUID()
  dealId?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @IsIn(INCOME_CATEGORIES as unknown as string[])
  category!: IncomeCategory;

  @IsIn(['ONE_TIME', 'MONTHLY'])
  billing!: 'ONE_TIME' | 'MONTHLY';

  // ONE_TIME: valor total. MONTHLY: valor de cada mensalidade.
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

  // MONTHLY: dia da cobrança (padrão: dia de startDate).
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(31)
  billingDay?: number;

  // Gera a receita prevista junto: ONE_TIME -> 1 lançamento PLANNED com o
  // valor total; MONTHLY -> molde de recorrência mensal. Padrão: true.
  @IsOptional()
  @IsBoolean()
  generateBilling?: boolean;

  // ONE_TIME: vencimento do lançamento previsto (padrão: startDate).
  @IsOptional()
  @IsDateKey()
  firstDueDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class UpdateContractDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'COMPLETED', 'CANCELLED'])
  status?: 'ACTIVE' | 'COMPLETED' | 'CANCELLED';

  @IsOptional()
  @IsDateKey()
  endDate?: string | null;

  // MONTHLY: o novo valor vale para as próximas mensalidades geradas; as já
  // geradas não mudam (são lançamentos independentes do contrato).
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_AMOUNT_CENTS)
  valueCents?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

export class CreateContractFromDealDto {
  @IsOptional()
  @IsIn(INCOME_CATEGORIES as unknown as string[])
  category?: IncomeCategory;

  @IsOptional()
  @IsIn(['ONE_TIME', 'MONTHLY'])
  billing?: 'ONE_TIME' | 'MONTHLY';

  // Padrão: valor do negócio.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_AMOUNT_CENTS)
  valueCents?: number;

  @IsOptional()
  @IsDateKey()
  startDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(31)
  billingDay?: number;

  @IsOptional()
  @IsDateKey()
  firstDueDate?: string;

  // Cria as tarefas de implantação do cliente. Padrão: true.
  @IsOptional()
  @IsBoolean()
  createImplementationTasks?: boolean;
}

export class ListContractsQueryDto {
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'COMPLETED', 'CANCELLED'])
  status?: 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
}
