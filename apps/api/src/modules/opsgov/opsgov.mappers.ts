import type {
  CompanyActivity,
  CompanyProfile,
  CompanyRegistrationPeriod,
  TaxRegimePeriod,
} from '@opsmind/database';
import { toDateKey } from '@opsmind/shared-types';
import type {
  CompanyActivityView,
  CompanyProfileView,
  RegistrationPeriodView,
  TaxRegimePeriodView,
} from './opsgov.types';

type PeriodRow = Pick<
  CompanyRegistrationPeriod,
  'id' | 'validFrom' | 'validTo' | 'notes' | 'documentId' | 'actorType' | 'actorId' | 'createdAt'
>;

function periodFields(row: PeriodRow) {
  return {
    id: row.id,
    validFrom: toDateKey(row.validFrom),
    validTo: row.validTo ? toDateKey(row.validTo) : null,
    notes: row.notes,
    documentId: row.documentId,
    actorType: row.actorType,
    actorId: row.actorId,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toRegistrationView(row: CompanyRegistrationPeriod): RegistrationPeriodView {
  return { ...periodFields(row), naturezaJuridica: row.naturezaJuridica, cnpj: row.cnpj };
}

export function toRegimeView(row: TaxRegimePeriod): TaxRegimePeriodView {
  return { ...periodFields(row), regime: row.regime, ibsCbsMode: row.ibsCbsMode };
}

export function toActivityView(row: CompanyActivity): CompanyActivityView {
  return {
    ...periodFields(row),
    cnae: row.cnae,
    description: row.description,
    isPrimary: row.isPrimary,
    anexoSimples: row.anexoSimples,
    revenueGroup: row.revenueGroup,
  };
}

export function toProfileView(row: CompanyProfile): CompanyProfileView {
  return {
    razaoSocial: row.razaoSocial,
    nomeFantasia: row.nomeFantasia,
    cnpj: row.cnpj,
    enderecoFiscal: row.enderecoFiscal,
    municipio: row.municipio,
    uf: row.uf,
    inscricaoMunicipal: row.inscricaoMunicipal,
    inscricaoEstadual: row.inscricaoEstadual,
    updatedAt: row.updatedAt.toISOString(),
  };
}
