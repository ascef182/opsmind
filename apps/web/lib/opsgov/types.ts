import type { Role, SimulationResult } from '@opsmind/shared-types';

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

// ── Fase 2: receita por atividade ──────────────────────────────────────────
export const OPSGOV_FINANCE_ROLES: Role[] = ['OWNER', 'ADMIN', 'MANAGER'];

export type RevenueBasis = 'COMPETENCIA' | 'CAIXA';
export const REVENUE_BASIS_LABELS: Record<RevenueBasis, string> = {
  COMPETENCIA: 'Competência (emissão)',
  CAIXA: 'Caixa (recebimento)',
};

export interface UnclassifiedEntry {
  id: string;
  description: string;
  customerName: string | null;
  amountCents: number;
  status: string;
  issueDate: string;
}

export interface RevenueLine {
  monthsCents: number[];
  totalCents: number;
}

export interface RevenueByActivity {
  basis: RevenueBasis;
  months: string[];
  rows: Array<RevenueLine & { cnae: string; description: string; revenueGroup: RevenueGroup }>;
  groups: Array<RevenueLine & { revenueGroup: RevenueGroup }>;
  unclassified: RevenueLine;
  totals: RevenueLine;
}

export type Rbt12Method = 'TWELVE_MONTHS' | 'START_MONTH' | 'START_AVERAGE';
export const RBT12_METHOD_LABELS: Record<Rbt12Method, string> = {
  TWELVE_MONTHS: 'Soma dos 12 meses anteriores',
  START_MONTH: 'Início de atividade: receita do mês × 12',
  START_AVERAGE: 'Início de atividade: média dos meses anteriores × 12',
};

export interface Rbt12 {
  month: string;
  rbt12Cents: number;
  method: Rbt12Method;
  monthsConsidered: string[];
  basis: RevenueBasis;
  activityStartMonth: string | null;
}

// ── Fase 3: simulador do Simples ───────────────────────────────────────────
// O resultado vem da função pura `simulate` de @opsmind/shared-types (a mesma
// que a API usa); aqui só o envelope do cenário real.

export interface RealSimulation {
  rbt12: Rbt12;
  regimeVigente: TaxRegimePeriod | null;
  simulation: SimulationResult | null;
}

// ── Fase 4: obrigações e certidões ─────────────────────────────────────────
export type ComplianceObligationType = 'DAS' | 'DASN_SIMEI' | 'DEFIS' | 'TAXA_MUNICIPAL' | 'CERTIFICADO_DIGITAL' | 'OUTRA';
export type ObligationRecurrence = 'MONTHLY' | 'YEARLY' | 'ONCE';
export type ObligationStatus = 'PENDENTE' | 'CUMPRIDA' | 'DISPENSADA';
export type CertificateType = 'CND_FEDERAL' | 'ESTADUAL' | 'MUNICIPAL' | 'FGTS_CRF' | 'CNDT_TRABALHISTA' | 'FALENCIA';
export type CertificateStatus = 'VALIDA' | 'VENCENDO' | 'VENCIDA';

export const OBLIGATION_TYPE_LABELS: Record<ComplianceObligationType, string> = {
  DAS: 'DAS',
  DASN_SIMEI: 'DASN-SIMEI',
  DEFIS: 'DEFIS',
  TAXA_MUNICIPAL: 'Taxa municipal',
  CERTIFICADO_DIGITAL: 'Certificado digital',
  OUTRA: 'Outra',
};
export const RECURRENCE_LABELS: Record<ObligationRecurrence, string> = {
  MONTHLY: 'Mensal',
  YEARLY: 'Anual',
  ONCE: 'Data única',
};
export const OBLIGATION_STATUS_LABELS: Record<ObligationStatus, string> = {
  PENDENTE: 'Pendente',
  CUMPRIDA: 'Cumprida',
  DISPENSADA: 'Dispensada',
};
export const CERTIFICATE_TYPE_LABELS: Record<CertificateType, string> = {
  CND_FEDERAL: 'CND Federal (Receita/PGFN)',
  ESTADUAL: 'Certidão estadual',
  MUNICIPAL: 'Certidão municipal',
  FGTS_CRF: 'CRF do FGTS',
  CNDT_TRABALHISTA: 'CNDT (trabalhista)',
  FALENCIA: 'Certidão de falência',
};
export const CERTIFICATE_STATUS_LABELS: Record<CertificateStatus, string> = {
  VALIDA: 'Válida',
  VENCENDO: 'Vencendo',
  VENCIDA: 'Vencida',
};

export interface Obligation {
  id: string;
  type: ComplianceObligationType;
  title: string;
  recurrence: ObligationRecurrence;
  dueDay: number | null;
  dueMonth: number | null;
  nextDueDate: string;
  daysUntilDue: number;
  status: ObligationStatus;
  notes: string | null;
  lastCompletion: { dueDate: string; completedOn: string; documentId: string | null } | null;
}

export interface Certificate {
  id: string;
  type: CertificateType;
  issuer: string | null;
  code: string | null;
  issuedOn: string;
  validUntil: string;
  daysUntilExpiry: number;
  status: CertificateStatus;
  isCurrent: boolean;
  notes: string | null;
  documentId: string | null;
}

export interface CreateObligationInput {
  type: ComplianceObligationType;
  title: string;
  recurrence: ObligationRecurrence;
  dueDay?: number;
  dueMonth?: number;
  firstDueDate?: string;
  notes?: string;
}

export interface CreateCertificateInput {
  type: CertificateType;
  issuer?: string;
  code?: string;
  issuedOn: string;
  validUntil: string;
  notes?: string;
  documentId?: string;
}
