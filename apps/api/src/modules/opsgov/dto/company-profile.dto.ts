import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, Length, MaxLength } from 'class-validator';
import {
  ANEXOS_SIMPLES,
  IBS_CBS_MODES,
  NATUREZAS_JURIDICAS,
  REVENUE_GROUPS,
  TAX_REGIMES,
  type AnexoSimples,
  type IbsCbsMode,
  type NaturezaJuridica,
  type RevenueGroup,
  type TaxRegime,
} from '@opsmind/shared-types';
import { IsDateKey } from '../../finance/dto/validators';

export class UpsertCompanyProfileDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  razaoSocial!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  nomeFantasia?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  enderecoFiscal?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  municipio?: string;

  @IsOptional()
  @IsString()
  @Length(2, 2)
  uf?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  inscricaoMunicipal?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  inscricaoEstadual?: string;
}

class PeriodBaseDto {
  @IsDateKey()
  validFrom!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsUUID()
  documentId?: string;
}

export class ChangeRegistrationDto extends PeriodBaseDto {
  @IsIn(NATUREZAS_JURIDICAS as unknown as string[])
  naturezaJuridica!: NaturezaJuridica;

  @IsString()
  @MaxLength(20)
  cnpj!: string;
}

export class ChangeRegimeDto extends PeriodBaseDto {
  @IsIn(TAX_REGIMES as unknown as string[])
  regime!: TaxRegime;

  @IsIn(IBS_CBS_MODES as unknown as string[])
  ibsCbsMode!: IbsCbsMode;
}

export class AddActivityDto extends PeriodBaseDto {
  @IsString()
  @MaxLength(12)
  cnae!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  description!: string;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @IsOptional()
  @IsIn(ANEXOS_SIMPLES as unknown as string[])
  anexoSimples?: AnexoSimples;

  @IsOptional()
  @IsIn(REVENUE_GROUPS as unknown as string[])
  revenueGroup?: RevenueGroup;
}

// Nova versão de uma atividade vigente (muda anexo/grupo/principal a partir
// de uma data): fecha a atual e abre outra com o mesmo CNAE.
export class ChangeActivityDto extends PeriodBaseDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  description?: string;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @IsOptional()
  @IsIn(ANEXOS_SIMPLES as unknown as string[])
  anexoSimples?: AnexoSimples;

  @IsOptional()
  @IsIn(REVENUE_GROUPS as unknown as string[])
  revenueGroup?: RevenueGroup;
}

export class EndActivityDto {
  @IsDateKey()
  validTo!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class SnapshotQueryDto {
  @IsOptional()
  @IsDateKey()
  date?: string;
}
