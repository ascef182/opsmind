import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import {
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  type FinancialCategory,
  type FinancialScope,
  type ForeignCurrency,
} from '@opsmind/shared-types';
import { DEFAULT_LIST_LIMIT, MAX_AMOUNT_CENTS, MAX_LIST_LIMIT } from '../finance.constants';
import { IsDateKey } from './validators';

const ALL_CATEGORIES: FinancialCategory[] = [...INCOME_CATEGORIES, ...EXPENSE_CATEGORIES];
const ALL_SCOPES: FinancialScope[] = ['BUSINESS', 'PERSONAL'];
const ALL_FOREIGN_CURRENCIES: ForeignCurrency[] = ['USD'];

// `organizationId`/`actorType`/`actorId`/`paidCents`/`status` (exceto o estado
// inicial) nunca vêm do cliente: pago e status só mudam via pagamento/estorno/
// cancelamento, para que o saldo nunca divirja dos pagamentos.
export class CreateEntryDto {
  @IsIn(['INCOME', 'EXPENSE'])
  direction!: 'INCOME' | 'EXPENSE';

  @IsIn(ALL_CATEGORIES)
  category!: FinancialCategory;

  // Empresa (CNPJ) ou pessoal. Padrão: BUSINESS (ver service).
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

  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsUUID()
  contractId?: string;

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

  // Moeda estrangeira nominal deste lançamento (ex.: herdado de um molde em
  // USD, ou informado num lançamento avulso). Cotação/IOF reais do mês vêm
  // à parte, quando o usuário reconcilia — nunca calculados automaticamente.
  @IsOptional()
  @IsIn(ALL_FOREIGN_CURRENCIES)
  foreignCurrency?: ForeignCurrency;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_AMOUNT_CENTS)
  foreignAmountCents?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.0001)
  exchangeRate?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_AMOUNT_CENTS)
  iofCents?: number;

  // Padrão: hoje. Para um PLANNED, é a data prevista da emissão.
  @IsOptional()
  @IsDateKey()
  issueDate?: string;

  @IsDateKey()
  dueDate!: string;

  // Previsto (ainda não cobrado) ou pendente (cobrado). Padrão: PENDING.
  @IsOptional()
  @IsIn(['PLANNED', 'PENDING'])
  status?: 'PLANNED' | 'PENDING';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

// `null` desvincula cliente/contrato (IsOptional deixa null passar).
export class UpdateEntryDto {
  @IsOptional()
  @IsIn(ALL_CATEGORIES)
  category?: FinancialCategory;

  @IsOptional()
  @IsIn(ALL_SCOPES)
  scope?: FinancialScope;

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
  @IsUUID()
  customerId?: string | null;

  @IsOptional()
  @IsUUID()
  contractId?: string | null;

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
  @IsNumber()
  @Min(0.0001)
  exchangeRate?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_AMOUNT_CENTS)
  iofCents?: number | null;

  @IsOptional()
  @IsDateKey()
  issueDate?: string;

  @IsOptional()
  @IsDateKey()
  dueDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

export class RegisterPaymentDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_AMOUNT_CENTS)
  amountCents!: number;

  // Padrão: hoje (São Paulo). Data futura é recusada no service.
  @IsOptional()
  @IsDateKey()
  paidAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  method?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ReasonDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}

export class IssueEntryDto {
  @IsOptional()
  @IsDateKey()
  dueDate?: string;
}

export class ListEntriesQueryDto {
  @IsOptional()
  @IsIn(['INCOME', 'EXPENSE'])
  direction?: 'INCOME' | 'EXPENSE';

  // OVERDUE não é um status gravado (é derivado) mas é o filtro mais usado.
  @IsOptional()
  @IsIn(['PLANNED', 'PENDING', 'PARTIAL', 'PAID', 'CANCELLED', 'OVERDUE'])
  status?: 'PLANNED' | 'PENDING' | 'PARTIAL' | 'PAID' | 'CANCELLED' | 'OVERDUE';

  @IsOptional()
  @IsIn(ALL_CATEGORIES)
  category?: FinancialCategory;

  @IsOptional()
  @IsIn(ALL_SCOPES)
  scope?: FinancialScope;

  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsUUID()
  contractId?: string;

  // Intervalo sobre o VENCIMENTO.
  @IsOptional()
  @IsDateKey()
  from?: string;

  @IsOptional()
  @IsDateKey()
  to?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  // Ordena pelo vencimento. Padrão: mais recente primeiro.
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sort?: 'asc' | 'desc';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_LIST_LIMIT)
  limit: number = DEFAULT_LIST_LIMIT;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset: number = 0;
}
