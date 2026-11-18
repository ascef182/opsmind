import type { Role } from '@opsmind/shared-types';

// Tipos duplicados localmente de propósito (ver lib/customers/types.ts):
// espelham as views de apps/api/src/modules/opsgov/opsgov.types.ts.

export const OPSGOV_WRITE_ROLES: Role[] = ['OWNER', 'ADMIN', 'MANAGER', 'MEMBER'];

export type NaturezaJuridica = 'MEI' | 'EI' | 'SLU' | 'LTDA';
export type TaxRegime = 'SIMEI' | 'SIMPLES_NACIONAL' | 'LUCRO_PRESUMIDO' | 'LUCRO_REAL';
export type IbsCbsMode = 'DENTRO_DAS' | 'REGULAR' | 'NAO_SE_APLICA';
export type AnexoSimples = 'I' | 'II' | 'III' | 'IV' | 'V' | 'FATOR_R' | 'NAO_DEFINIDO';
export type RevenueGroup = 'TECNOLOGIA' | 'TRADUCAO_LEGENDAGEM' | 'OUTROS';

export const NATUREZA_LABELS: Record<NaturezaJuridica, string> = {
  MEI: 'MEI',
  EI: 'Empresário individual',
  SLU: 'Sociedade limitada unipessoal',
  LTDA: 'Sociedade limitada',
};
export const REGIME_LABELS: Record<TaxRegime, string> = {
  SIMEI: 'SIMEI',
  SIMPLES_NACIONAL: 'Simples Nacional',
  LUCRO_PRESUMIDO: 'Lucro Presumido',
  LUCRO_REAL: 'Lucro Real',
};
export const IBS_CBS_LABELS: Record<IbsCbsMode, string> = {
  DENTRO_DAS: 'Dentro do DAS',
  REGULAR: 'Regime regular',
  NAO_SE_APLICA: 'Não se aplica',
};
export const ANEXO_LABELS: Record<AnexoSimples, string> = {
  I: 'Anexo I',
  II: 'Anexo II',
  III: 'Anexo III',
  IV: 'Anexo IV',
  V: 'Anexo V',
  FATOR_R: 'Fator R (III ou V)',
  NAO_DEFINIDO: 'Não definido',
};
export const REVENUE_GROUP_LABELS: Record<RevenueGroup, string> = {
  TECNOLOGIA: 'Tecnologia',
  TRADUCAO_LEGENDAGEM: 'Tradução e legendagem',
  OUTROS: 'Outros',
};

interface Period {
  id: string;
  validFrom: string;
  validTo: string | null;
  notes: string | null;
  documentId: string | null;
  actorType: string;
  actorId: string | null;
  createdAt: string;
}

export interface RegistrationPeriod extends Period {
  naturezaJuridica: NaturezaJuridica;
  cnpj: string;
}

export interface TaxRegimePeriod extends Period {
  regime: TaxRegime;
  ibsCbsMode: IbsCbsMode;
}

export interface CompanyActivity extends Period {
  cnae: string;
  description: string;
  isPrimary: boolean;
  anexoSimples: AnexoSimples;
  revenueGroup: RevenueGroup;
}

export interface CompanyProfile {
  razaoSocial: string;
  nomeFantasia: string | null;
  cnpj: string | null;
  enderecoFiscal: string | null;
  municipio: string | null;
  uf: string | null;
  inscricaoMunicipal: string | null;
  inscricaoEstadual: string | null;
  updatedAt: string;
}

export interface CompanyOverview {
  profile: CompanyProfile | null;
  registrationPeriods: RegistrationPeriod[];
  taxRegimePeriods: TaxRegimePeriod[];
  activities: CompanyActivity[];
}

export interface UpsertProfileInput {
  razaoSocial: string;
  nomeFantasia?: string;
  enderecoFiscal?: string;
  municipio?: string;
  uf?: string;
  inscricaoMunicipal?: string;
  inscricaoEstadual?: string;
}

interface PeriodInput {
  validFrom: string;
  notes?: string;
  documentId?: string;
}

export interface ChangeRegistrationInput extends PeriodInput {
  naturezaJuridica: NaturezaJuridica;
  cnpj: string;
}

export interface ChangeRegimeInput extends PeriodInput {
  regime: TaxRegime;
  ibsCbsMode: IbsCbsMode;
}

export interface AddActivityInput extends PeriodInput {
  cnae: string;
  description: string;
  isPrimary?: boolean;
  anexoSimples?: AnexoSimples;
  revenueGroup?: RevenueGroup;
}

export interface ChangeActivityInput extends PeriodInput {
  description?: string;
  isPrimary?: boolean;
  anexoSimples?: AnexoSimples;
  revenueGroup?: RevenueGroup;
}

export function formatCnpj(digits: string | null): string {
  if (!digits || digits.length !== 14) return digits ?? '—';
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}
