import type { AuditActorType } from '@opsmind/database';
import type {
  AnexoSimples,
  IbsCbsMode,
  NaturezaJuridica,
  RevenueGroup,
  TaxRegime,
} from '@opsmind/shared-types';

export interface OpsGovActor {
  type: AuditActorType;
  id: string;
}

interface PeriodView {
  id: string;
  validFrom: string;
  validTo: string | null;
  notes: string | null;
  documentId: string | null;
  actorType: AuditActorType;
  actorId: string | null;
  createdAt: string;
}

export interface RegistrationPeriodView extends PeriodView {
  naturezaJuridica: NaturezaJuridica;
  cnpj: string;
}

export interface TaxRegimePeriodView extends PeriodView {
  regime: TaxRegime;
  ibsCbsMode: IbsCbsMode;
}

export interface CompanyActivityView extends PeriodView {
  cnae: string;
  description: string;
  isPrimary: boolean;
  anexoSimples: AnexoSimples;
  revenueGroup: RevenueGroup;
}

export interface CompanyProfileView {
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
  profile: CompanyProfileView | null;
  registrationPeriods: RegistrationPeriodView[];
  taxRegimePeriods: TaxRegimePeriodView[];
  activities: CompanyActivityView[];
}

export interface CompanySnapshot {
  date: string;
  registration: RegistrationPeriodView | null;
  regime: TaxRegimePeriodView | null;
  activities: CompanyActivityView[];
}
