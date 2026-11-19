import { CERTIFICATE_TYPES, certificateStatus, daysBetween, type CertificateType } from './compliance-calendar';
import { activeAt, isActiveAt, type ValidityPeriod } from './opsgov-validity';

// Prontidão para licitações (OpsGov Fase 6). Datas 'YYYY-MM-DD'.

export const PROCUREMENT_STATUSES = ['RADAR', 'ANALISE', 'PROPOSTA', 'DISPUTA', 'GANHA', 'PERDIDA', 'DESCARTADA'] as const;
export type ProcurementStatus = (typeof PROCUREMENT_STATUSES)[number];

export const PROCUREMENT_MODALITIES = [
  'PREGAO_ELETRONICO',
  'PREGAO_PRESENCIAL',
  'CONCORRENCIA',
  'DISPENSA',
  'INEXIGIBILIDADE',
  'CREDENCIAMENTO',
  'OUTRA',
] as const;
export type ProcurementModality = (typeof PROCUREMENT_MODALITIES)[number];

export const PROCUREMENT_REQUIREMENT_TYPES = ['DOCUMENTO', 'CERTIDAO', 'ATESTADO', 'CNAE', 'DECLARACAO'] as const;
export type ProcurementRequirementType = (typeof PROCUREMENT_REQUIREMENT_TYPES)[number];

export const PROCUREMENT_REQUIREMENT_SOURCES = ['MANUAL', 'AI_SUGGESTION_CONFIRMED'] as const;
export type ProcurementRequirementSource = (typeof PROCUREMENT_REQUIREMENT_SOURCES)[number];

/** Avanço é linear; DESCARTADA vale de qualquer estado não final. */
export const PROCUREMENT_TRANSITIONS: Record<ProcurementStatus, readonly ProcurementStatus[]> = {
  RADAR: ['ANALISE', 'DESCARTADA'],
  ANALISE: ['PROPOSTA', 'DESCARTADA'],
  PROPOSTA: ['DISPUTA', 'DESCARTADA'],
  DISPUTA: ['GANHA', 'PERDIDA', 'DESCARTADA'],
  GANHA: [],
  PERDIDA: [],
  DESCARTADA: [],
};

/** Encerrar sem vitória exige motivo, para o histórico servir de aprendizado. */
export const PROCUREMENT_STATUSES_REQUIRING_REASON: readonly ProcurementStatus[] = ['PERDIDA', 'DESCARTADA'];

export function canTransitionProcurement(from: ProcurementStatus, to: ProcurementStatus): boolean {
  return PROCUREMENT_TRANSITIONS[from].includes(to);
}

export function isProcurementOpen(status: ProcurementStatus): boolean {
  return PROCUREMENT_TRANSITIONS[status].length > 0;
}

export interface ReadinessCertificate {
  type: CertificateType;
  issuedOn: string;
  validUntil: string;
}

export interface ReadinessActivity extends ValidityPeriod {
  cnae: string;
}

export interface ReadinessRequirement {
  id: string;
  type: ProcurementRequirementType;
  description: string;
  certificateType: CertificateType | null;
  requiredCnae: string | null;
  technicalCertificateId: string | null;
  manuallyMet: boolean;
}

export interface ProcurementReadinessInput {
  requirements: readonly ReadinessRequirement[];
  certificates: readonly ReadinessCertificate[];
  activities: readonly ReadinessActivity[];
  registrationPeriods: readonly ValidityPeriod[];
  regimePeriods: readonly ValidityPeriod[];
  /** Ids dos atestados que existem na organização (vínculo apagado não conta). */
  technicalCertificateIds: ReadonlySet<string>;
  sessionDate: string | null;
  today: string;
}

export interface RequirementCheck {
  requirementId: string;
  met: boolean;
  reason: string;
}

export interface ProcurementReadiness {
  /** Data contra a qual tudo é avaliado: a sessão, ou hoje se ainda não marcada. */
  referenceDate: string;
  checks: RequirementCheck[];
  metCount: number;
  total: number;
  /** 0–100, inteiro. Sem requisitos cadastrados = 0 (nada comprovado ainda). */
  score: number;
  blockers: string[];
  ready: boolean;
}

/** 'YYYY-MM-DD' → 'DD/MM/YYYY', para as mensagens exibidas ao usuário. */
function br(dateKey: string): string {
  return `${dateKey.slice(8, 10)}/${dateKey.slice(5, 7)}/${dateKey.slice(0, 4)}`;
}

/** A certidão do tipo que vale na data: emitida até ela, com a maior validade. */
export function certificateForDate(
  certificates: readonly ReadinessCertificate[],
  type: CertificateType,
  date: string,
): ReadinessCertificate | null {
  let best: ReadinessCertificate | null = null;
  for (const c of certificates) {
    if (c.type !== type || c.issuedOn > date) continue;
    if (!best || c.validUntil > best.validUntil) best = c;
  }
  return best;
}

function checkRequirement(req: ReadinessRequirement, input: ProcurementReadinessInput, date: string): RequirementCheck {
  const result = (met: boolean, reason: string) => ({ requirementId: req.id, met, reason });
  switch (req.type) {
    case 'CERTIDAO': {
      if (!req.certificateType) return result(false, 'Tipo de certidão não informado');
      const cert = certificateForDate(input.certificates, req.certificateType, date);
      if (!cert) return result(false, 'Nenhuma certidão registrada');
      if (cert.validUntil < date) {
        return cert.validUntil >= input.today
          ? result(false, `Vence em ${br(cert.validUntil)}, antes da sessão`)
          : result(false, `Vencida em ${br(cert.validUntil)}`);
      }
      return result(true, `Válida até ${br(cert.validUntil)}`);
    }
    case 'CNAE': {
      if (!req.requiredCnae) return result(false, 'CNAE exigido não informado');
      const match = input.activities.some((a) => a.cnae === req.requiredCnae && isActiveAt(a, date));
      return match ? result(true, `CNAE ${req.requiredCnae} vigente`) : result(false, `CNAE ${req.requiredCnae} sem atividade vigente`);
    }
    case 'ATESTADO':
      return req.technicalCertificateId && input.technicalCertificateIds.has(req.technicalCertificateId)
        ? result(true, 'Atestado vinculado')
        : result(false, 'Nenhum atestado vinculado');
    case 'DOCUMENTO':
    case 'DECLARACAO':
      return req.manuallyMet ? result(true, 'Marcado como atendido') : result(false, 'Pendente');
  }
}

/**
 * Habilitação é tudo ou nada: cada requisito não atendido é um bloqueador,
 * assim como cadastro ou regime sem vigência na data da sessão.
 */
export function procurementReadiness(input: ProcurementReadinessInput): ProcurementReadiness {
  const date = input.sessionDate ?? input.today;
  const blockers: string[] = [];
  if (!activeAt(input.registrationPeriods, date)) blockers.push('Cadastro da empresa sem vigência na data da sessão');
  if (!activeAt(input.regimePeriods, date)) blockers.push('Regime tributário sem vigência na data da sessão');
  const checks = input.requirements.map((req) => {
    const check = checkRequirement(req, input, date);
    if (!check.met) blockers.push(`${req.description}: ${check.reason}`);
    return check;
  });
  const metCount = checks.filter((c) => c.met).length;
  const total = checks.length;
  return {
    referenceDate: date,
    checks,
    metCount,
    total,
    score: total === 0 ? 0 : Math.floor((metCount * 100) / total),
    blockers,
    ready: total > 0 && blockers.length === 0,
  };
}

export type CompanyReadinessSeverity = 'BLOCKER' | 'WARNING';

export interface CompanyReadinessIssue {
  severity: CompanyReadinessSeverity;
  message: string;
}

export interface CompanyReadinessInput {
  hasProfile: boolean;
  registrationPeriods: readonly ValidityPeriod[];
  regimePeriods: readonly ValidityPeriod[];
  activities: readonly ReadinessActivity[];
  certificates: readonly ReadinessCertificate[];
  overdueObligations: number;
  today: string;
}

const CERTIFICATE_NAMES: Record<CertificateType, string> = {
  CND_FEDERAL: 'CND Federal',
  ESTADUAL: 'Estadual',
  MUNICIPAL: 'Municipal',
  FGTS_CRF: 'FGTS (CRF)',
  CNDT_TRABALHISTA: 'CNDT Trabalhista',
  FALENCIA: 'Falência',
};

/** Pendências gerais da empresa, independentes de um edital específico. */
export function companyReadinessIssues(input: CompanyReadinessInput): CompanyReadinessIssue[] {
  const issues: CompanyReadinessIssue[] = [];
  const blocker = (message: string) => issues.push({ severity: 'BLOCKER', message });
  const warning = (message: string) => issues.push({ severity: 'WARNING', message });

  if (!input.hasProfile) blocker('Perfil da empresa não preenchido');
  if (!activeAt(input.registrationPeriods, input.today)) blocker('Nenhum cadastro (natureza jurídica/CNPJ) vigente hoje');
  if (!activeAt(input.regimePeriods, input.today)) blocker('Nenhum regime tributário vigente hoje');
  if (!input.activities.some((a) => isActiveAt(a, input.today))) blocker('Nenhum CNAE vigente hoje');

  for (const type of CERTIFICATE_TYPES) {
    const cert = certificateForDate(input.certificates, type, input.today);
    if (!cert) {
      warning(`Certidão ${CERTIFICATE_NAMES[type]} não registrada`);
      continue;
    }
    const status = certificateStatus(cert.validUntil, input.today);
    if (status === 'VENCIDA') blocker(`Certidão ${CERTIFICATE_NAMES[type]} vencida em ${br(cert.validUntil)}`);
    else if (status === 'VENCENDO') {
      warning(`Certidão ${CERTIFICATE_NAMES[type]} vence em ${daysBetween(input.today, cert.validUntil)} dia(s)`);
    }
  }

  if (input.overdueObligations > 0) blocker(`${input.overdueObligations} obrigação(ões) vencida(s) sem cumprimento`);
  return issues;
}
