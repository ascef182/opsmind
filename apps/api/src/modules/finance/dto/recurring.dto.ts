import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import {
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  type FinancialCategory,
  type FinancialScope,
  type ForeignCurrency,
} from '@opsmind/shared-types';
import { MAX_AMOUNT_CENTS } from '../finance.constants';
import { IsMonthKey } from './validators';

const ALL_CATEGORIES: FinancialCategory[] = [...INCOME_CATEGORIES, ...EXPENSE_CATEGORIES];
const ALL_SCOPES: FinancialScope[] = ['BUSINESS', 'PERSONAL'];
const ALL_FOREIGN_CURRENCIES: ForeignCurrency[] = ['USD'];

export class CreateRecurringDto {
  @IsIn(['INCOME', 'EXPENSE'])
  direction!: 'INCOME' | 'EXPENSE';

  @IsIn(ALL_CATEGORIES)
  category!: FinancialCategory;

  // Empresa (CNPJ) ou pessoal. Padrão: BUSINESS. Imutável após criar (como
  // direction/category) — trocar o escopo de um molde já em andamento seria
  // reclassificar lançamentos passados sem querer.
  @IsOptional()
  @IsIn(ALL_SCOPES)
  scope?: FinancialScope;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  description!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  supplierName?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_AMOUNT_CENTS)
  amountCents!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_AMOUNT_CENTS)
  feesCents?: number;

  // Valor nominal de referência em moeda estrangeira (ex.: Railway = US$
  // 5,00/mês). amountCents continua sendo a estimativa em reais usada para
  // gerar os lançamentos — a cotação/IOF reais ficam em cada FinancialEntry.
  @IsOptional()
  @IsIn(ALL_FOREIGN_CURRENCIES)
  foreignCurrency?: ForeignCurrency;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_AMOUNT_CENTS)
  foreignAmountCents?: number;

  // Dia 29-31 em mês curto cai no último dia do mês.
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(31)
  dayOfMonth!: number;

  // Padrão: mês corrente.
  @IsOptional()
  @IsMonthKey()
  startMonth?: string;

  @IsOptional()
  @IsMonthKey()
  endMonth?: string;

  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsUUID()
  contractId?: string;
}

export class UpdateRecurringDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  supplierName?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_AMOUNT_CENTS)
  amountCents?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_AMOUNT_CENTS)
  feesCents?: number;

  @IsOptional()
  @IsIn(ALL_FOREIGN_CURRENCIES)
  foreignCurrency?: ForeignCurrency | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_AMOUNT_CENTS)
  foreignAmountCents?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(31)
  dayOfMonth?: number;

  @IsOptional()
  @IsMonthKey()
  endMonth?: string | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class GenerateRecurringDto {
  // Gera até este mês (inclusive). Padrão e teto: mês corrente.
  @IsOptional()
  @IsMonthKey()
  upToMonth?: string;
}
