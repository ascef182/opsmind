import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, ProcurementOpportunity, ProcurementRequirement } from '@opsmind/database';
import {
  PROCUREMENT_STATUSES_REQUIRING_REASON,
  PROCUREMENT_TRANSITIONS,
  canTransitionProcurement,
  companyReadinessIssues,
  fromDateKey,
  isProcurementOpen,
  normalizeCnae,
  procurementReadiness,
  toDateKey,
  todayInSaoPaulo,
  type CertificateType,
  type CompanyReadinessIssue,
  type ProcurementReadiness,
  type ProcurementReadinessInput,
  type ProcurementRequirementSource,
  type ProcurementRequirementType,
  type ProcurementStatus,
  type RevenueGroup,
} from '@opsmind/shared-types';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CustomersService } from '../customers/customers.service';
import { FinanceContractsService } from '../finance/finance-contracts.service';
import { assertDocumentOfOrganization } from './assert-document';
import { CompanyProfileService } from './company-profile.service';
import { ComplianceService, type CertificateView } from './compliance.service';
import type {
  ChangeOpportunityStatusDto,
  ConvertOpportunityDto,
  CreateOpportunityDto,
  CreateRequirementDto,
  UpdateOpportunityDto,
  UpdateRequirementDto,
} from './dto/procurement.dto';
import type { CompanyActivityView, OpsGovActor } from './opsgov.types';

export interface ReadinessSummary {
  score: number;
  metCount: number;
  total: number;
  blockerCount: number;
  ready: boolean;
}

export interface OpportunitySummary {
  id: string;
  agency: string;
  agencyCode: string | null;
  processNumber: string | null;
  modality: ProcurementOpportunity['modality'];
  object: string;
  sessionDate: string | null;
  proposalDeadline: string | null;
  estimatedValueCents: number | null;
  status: ProcurementStatus;
  statusChangedAt: string;
  converted: boolean;
  readiness: ReadinessSummary;
}

export interface RequirementView {
  id: string;
  type: ProcurementRequirementType;
  description: string;
  certificateType: CertificateType | null;
  requiredCnae: string | null;
  technicalCertificate: { id: string; issuer: string } | null;
  manuallyMet: boolean;
  documentId: string | null;
  source: ProcurementRequirementSource;
  notes: string | null;
  met: boolean;
  reason: string;
}

export interface OpportunityDetail extends Omit<OpportunitySummary, 'readiness'> {
  editalUrl: string | null;
  editalDocumentId: string | null;
  notes: string | null;
  customerId: string | null;
  contractId: string | null;
  convertedAt: string | null;
  nextStatuses: ProcurementStatus[];
  requirements: RequirementView[];
  readiness: ProcurementReadiness;
  statusChanges: Array<{
    id: string;
    fromStatus: ProcurementStatus | null;
    toStatus: ProcurementStatus;
    reason: string | null;
    actorId: string | null;
    createdAt: string;
  }>;
}

export interface ProcurementOverview {
  today: string;
  issues: CompanyReadinessIssue[];
  certificates: CertificateView[];
  activeActivities: CompanyActivityView[];
  technicalCertificatesByGroup: Array<{ revenueGroup: RevenueGroup | null; count: number; totalValueCents: number }>;
  openOpportunities: OpportunitySummary[];
}

type ReadinessContext = Omit<ProcurementReadinessInput, 'requirements' | 'sessionDate'>;

const REQUIREMENT_INCLUDE = {
  technicalCertificate: { select: { id: true, issuer: true } },
} satisfies Prisma.ProcurementRequirementInclude;

type RequirementRow = Prisma.ProcurementRequirementGetPayload<{ include: typeof REQUIREMENT_INCLUDE }>;

/**
 * Licitações. Toda mudança é humana via HTTP: a IA (Fase 7) só sugere
 * requisitos, que uma pessoa confirma. A prontidão nunca é gravada.
 */
@Injectable()
export class ProcurementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly companyProfile: CompanyProfileService,
    private readonly compliance: ComplianceService,
    private readonly customers: CustomersService,
    private readonly contracts: FinanceContractsService,
  ) {}

  async listOpportunities(organizationId: string, today = todayInSaoPaulo()): Promise<OpportunitySummary[]> {
    const rows = await this.prisma.procurementOpportunity.findMany({
      where: { organizationId },
      include: { requirements: { include: REQUIREMENT_INCLUDE } },
      orderBy: [{ sessionDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
    });
    const context = await this.readinessContext(organizationId, today);
    return rows.map((row) => this.toSummary(row, this.evaluate(row, row.requirements, context)));
  }

  async getOpportunity(organizationId: string, id: string, today = todayInSaoPaulo()): Promise<OpportunityDetail> {
    const row = await this.prisma.procurementOpportunity.findFirst({
      where: { id, organizationId },
      include: {
        requirements: { include: REQUIREMENT_INCLUDE, orderBy: { createdAt: 'asc' } },
        statusChanges: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!row) throw new NotFoundException('Licitação não encontrada');
    const readiness = this.evaluate(row, row.requirements, await this.readinessContext(organizationId, today));
    const checks = new Map(readiness.checks.map((c) => [c.requirementId, c]));
    return {
      ...this.toSummary(row, readiness),
      editalUrl: row.editalUrl,
      editalDocumentId: row.editalDocumentId,
      notes: row.notes,
      customerId: row.customerId,
      contractId: row.contractId,
      convertedAt: row.convertedAt?.toISOString() ?? null,
      nextStatuses: [...PROCUREMENT_TRANSITIONS[row.status]],
      requirements: row.requirements.map((req) => {
        const check = checks.get(req.id);
        return toRequirementView(req, check?.met ?? false, check?.reason ?? '');
      }),
      readiness,
      statusChanges: row.statusChanges.map((c) => ({
        id: c.id,
        fromStatus: c.fromStatus,
        toStatus: c.toStatus,
        reason: c.reason,
        actorId: c.actorId,
        createdAt: c.createdAt.toISOString(),
      })),
    };
  }

  async createOpportunity(organizationId: string, dto: CreateOpportunityDto, actor: OpsGovActor): Promise<OpportunityDetail> {
    await assertDocumentOfOrganization(this.prisma, organizationId, dto.editalDocumentId);
    const row = await this.prisma.procurementOpportunity.create({
      data: {
        organizationId,
        agency: dto.agency.trim(),
        agencyCode: dto.agencyCode?.trim() || null,
        processNumber: dto.processNumber?.trim() || null,
        modality: dto.modality,
        object: dto.object.trim(),
        editalUrl: dto.editalUrl ?? null,
        sessionDate: dto.sessionDate ? fromDateKey(dto.sessionDate) : null,
        proposalDeadline: dto.proposalDeadline ? fromDateKey(dto.proposalDeadline) : null,
        estimatedValueCents: dto.estimatedValueCents ?? null,
        editalDocumentId: dto.editalDocumentId ?? null,
        notes: dto.notes ?? null,
        actorType: actor.type,
        actorId: actor.id,
        statusChanges: {
          create: { organizationId, fromStatus: null, toStatus: 'RADAR', actorType: actor.type, actorId: actor.id },
        },
      },
    });
    await this.audit(organizationId, actor, 'opsgov.procurement.created', `ProcurementOpportunity:${row.id}`, {
      agency: row.agency,
      modality: row.modality,
    });
    return this.getOpportunity(organizationId, row.id);
  }

  async updateOpportunity(
    organizationId: string,
    id: string,
    dto: UpdateOpportunityDto,
    actor: OpsGovActor,
  ): Promise<OpportunityDetail> {
    const current = await this.findOpportunity(organizationId, id);
    const changed = Object.keys(dto).filter((k) => dto[k as keyof UpdateOpportunityDto] !== undefined);
    if (!isProcurementOpen(current.status) && changed.some((k) => k !== 'notes')) {
      throw new ConflictException('Licitação encerrada: só as anotações podem mudar');
    }
    await assertDocumentOfOrganization(this.prisma, organizationId, dto.editalDocumentId);
    const date = (v: string | null | undefined) => (v === undefined ? undefined : v === null ? null : fromDateKey(v));
    await this.prisma.procurementOpportunity.update({
      where: { id: current.id },
      data: {
        agency: dto.agency?.trim(),
        agencyCode: dto.agencyCode === undefined ? undefined : dto.agencyCode?.trim() || null,
        processNumber: dto.processNumber === undefined ? undefined : dto.processNumber?.trim() || null,
        modality: dto.modality,
        object: dto.object?.trim(),
        editalUrl: dto.editalUrl,
        sessionDate: date(dto.sessionDate),
        proposalDeadline: date(dto.proposalDeadline),
        estimatedValueCents: dto.estimatedValueCents,
        editalDocumentId: dto.editalDocumentId,
        notes: dto.notes,
      },
    });
    await this.audit(organizationId, actor, 'opsgov.procurement.updated', `ProcurementOpportunity:${current.id}`, {
      fields: changed,
    });
    return this.getOpportunity(organizationId, current.id);
  }

  async changeStatus(
    organizationId: string,
    id: string,
    dto: ChangeOpportunityStatusDto,
    actor: OpsGovActor,
  ): Promise<OpportunityDetail> {
    const reason = dto.reason?.trim() || null;
    const from = await this.prisma.runInTransaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM procurement_opportunities WHERE id = ${id} FOR UPDATE`;
      const current = await tx.procurementOpportunity.findFirst({ where: { id, organizationId } });
      if (!current) throw new NotFoundException('Licitação não encontrada');
      if (!canTransitionProcurement(current.status, dto.status)) {
        throw new ConflictException(`Não é possível passar de ${current.status} para ${dto.status}`);
      }
      if (PROCUREMENT_STATUSES_REQUIRING_REASON.includes(dto.status) && !reason) {
        throw new BadRequestException('Informe o motivo');
      }
      await tx.procurementOpportunity.update({
        where: { id: current.id },
        data: { status: dto.status, statusChangedAt: new Date() },
      });
      await tx.procurementStatusChange.create({
        data: {
          organizationId,
          opportunityId: current.id,
          fromStatus: current.status,
          toStatus: dto.status,
          reason,
          actorType: actor.type,
          actorId: actor.id,
        },
      });
      return current.status;
    });
    await this.audit(organizationId, actor, 'opsgov.procurement.status_changed', `ProcurementOpportunity:${id}`, {
      from,
      to: dto.status,
      reason,
    });
    return this.getOpportunity(organizationId, id);
  }

  async addRequirement(
    organizationId: string,
    opportunityId: string,
    dto: CreateRequirementDto,
    actor: OpsGovActor,
    source: ProcurementRequirementSource = 'MANUAL',
  ): Promise<RequirementView> {
    await this.findOpenOpportunity(organizationId, opportunityId);
    const fields = await this.requirementFields(organizationId, dto.type, dto);
    const row = await this.prisma.procurementRequirement.create({
      data: {
        organizationId,
        opportunityId,
        type: dto.type,
        description: dto.description.trim(),
        ...fields,
        source,
        notes: dto.notes ?? null,
        actorType: actor.type,
        actorId: actor.id,
      },
      include: REQUIREMENT_INCLUDE,
    });
    await this.audit(organizationId, actor, 'opsgov.procurement.requirement_added', `ProcurementRequirement:${row.id}`, {
      opportunityId,
      type: row.type,
      source,
    });
    return this.requirementWithCheck(organizationId, opportunityId, row.id);
  }

  async updateRequirement(
    organizationId: string,
    opportunityId: string,
    requirementId: string,
    dto: UpdateRequirementDto,
    actor: OpsGovActor,
  ): Promise<RequirementView> {
    await this.findOpenOpportunity(organizationId, opportunityId);
    const current = await this.findRequirement(organizationId, opportunityId, requirementId);
    if (dto.manuallyMet !== undefined && current.type !== 'DOCUMENTO' && current.type !== 'DECLARACAO') {
      throw new BadRequestException('Só documentos e declarações são marcados manualmente');
    }
    await assertDocumentOfOrganization(this.prisma, organizationId, dto.documentId);
    const fields = await this.requirementFields(organizationId, current.type, {
      certificateType: dto.certificateType ?? current.certificateType ?? undefined,
      requiredCnae: dto.requiredCnae ?? current.requiredCnae ?? undefined,
      technicalCertificateId:
        dto.technicalCertificateId === undefined ? (current.technicalCertificateId ?? undefined) : (dto.technicalCertificateId ?? undefined),
    });
    await this.prisma.procurementRequirement.update({
      where: { id: current.id },
      data: {
        description: dto.description?.trim(),
        ...fields,
        manuallyMet: dto.manuallyMet,
        documentId: dto.documentId,
        notes: dto.notes,
      },
    });
    await this.audit(organizationId, actor, 'opsgov.procurement.requirement_updated', `ProcurementRequirement:${current.id}`, {
      opportunityId,
      ...(dto.manuallyMet !== undefined ? { manuallyMet: dto.manuallyMet } : {}),
    });
    return this.requirementWithCheck(organizationId, opportunityId, current.id);
  }

  async removeRequirement(
    organizationId: string,
    opportunityId: string,
    requirementId: string,
    actor: OpsGovActor,
  ): Promise<void> {
    await this.findOpenOpportunity(organizationId, opportunityId);
    const current = await this.findRequirement(organizationId, opportunityId, requirementId);
    await this.prisma.procurementRequirement.delete({ where: { id: current.id } });
    await this.audit(organizationId, actor, 'opsgov.procurement.requirement_removed', `ProcurementRequirement:${current.id}`, {
      opportunityId,
      type: current.type,
      description: current.description,
      source: current.source,
    });
  }

  /** GANHA → cliente + contrato, uma vez só, reusando as regras de Clientes e Financeiro. */
  async convert(
    organizationId: string,
    id: string,
    dto: ConvertOpportunityDto,
    actor: OpsGovActor,
  ): Promise<OpportunityDetail> {
    const result = await this.prisma.runInTransaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM procurement_opportunities WHERE id = ${id} FOR UPDATE`;
      const current = await tx.procurementOpportunity.findFirst({ where: { id, organizationId } });
      if (!current) throw new NotFoundException('Licitação não encontrada');
      if (current.status !== 'GANHA') throw new ConflictException('Só licitações ganhas viram cliente e contrato');
      if (current.contractId) throw new ConflictException('Esta licitação já foi convertida');

      const customerId = dto.customerId
        ? (await this.customers.findByIdOrThrow(organizationId, dto.customerId)).id
        : (
            await this.customers.create(
              organizationId,
              { name: current.agency, company: current.agency, status: 'ACTIVE', tags: ['licitação'] },
              actor.id,
            )
          ).id;
      const contract = await this.contracts.create(
        organizationId,
        {
          customerId,
          title: dto.title?.trim() || contractTitle(current),
          category: dto.category ?? 'PROJECT',
          billing: dto.billing,
          valueCents: dto.valueCents,
          startDate: dto.startDate,
          endDate: dto.endDate,
          billingDay: dto.billingDay,
          firstDueDate: dto.firstDueDate,
          generateBilling: dto.generateBilling,
          notes: `Origem: licitação ${current.processNumber ?? current.id} (${current.agency})`,
        },
        actor,
      );
      await tx.procurementOpportunity.update({
        where: { id: current.id },
        data: { customerId, contractId: contract.id, convertedAt: new Date() },
      });
      return { customerId, contractId: contract.id };
    });
    await this.audit(organizationId, actor, 'opsgov.procurement.converted', `ProcurementOpportunity:${id}`, result);
    return this.getOpportunity(organizationId, id);
  }

  async overview(organizationId: string, today = todayInSaoPaulo()): Promise<ProcurementOverview> {
    const company = await this.companyProfile.overview(organizationId);
    const certificates = await this.compliance.listCertificates(organizationId, today);
    const overdueObligations = await this.prisma.complianceObligation.count({
      where: { organizationId, status: 'PENDENTE', nextDueDate: { lt: fromDateKey(today) } },
    });
    const technical = await this.prisma.technicalCertificate.findMany({
      where: { organizationId },
      select: { valueCents: true, companyActivity: { select: { revenueGroup: true } } },
    });
    const opportunities = await this.listOpportunities(organizationId, today);

    const groups = new Map<RevenueGroup | null, { count: number; totalValueCents: number }>();
    for (const t of technical) {
      const key = t.companyActivity?.revenueGroup ?? null;
      const group = groups.get(key) ?? { count: 0, totalValueCents: 0 };
      group.count += 1;
      group.totalValueCents += t.valueCents ?? 0;
      groups.set(key, group);
    }

    const activeActivities = company.activities.filter((a) => a.validFrom <= today && (a.validTo === null || today < a.validTo));
    return {
      today,
      issues: companyReadinessIssues({
        hasProfile: company.profile !== null,
        registrationPeriods: company.registrationPeriods,
        regimePeriods: company.taxRegimePeriods,
        activities: company.activities,
        certificates,
        overdueObligations,
        today,
      }),
      certificates: certificates.filter((c) => c.isCurrent),
      activeActivities,
      technicalCertificatesByGroup: [...groups].map(([revenueGroup, g]) => ({ revenueGroup, ...g })),
      openOpportunities: opportunities.filter((o) => isProcurementOpen(o.status)),
    };
  }

  private async readinessContext(organizationId: string, today: string): Promise<ReadinessContext> {
    const company = await this.companyProfile.overview(organizationId);
    const certificates = await this.prisma.certificate.findMany({
      where: { organizationId },
      select: { type: true, issuedOn: true, validUntil: true },
    });
    const technical = await this.prisma.technicalCertificate.findMany({ where: { organizationId }, select: { id: true } });
    return {
      today,
      activities: company.activities,
      registrationPeriods: company.registrationPeriods,
      regimePeriods: company.taxRegimePeriods,
      certificates: certificates.map((c) => ({ type: c.type, issuedOn: toDateKey(c.issuedOn), validUntil: toDateKey(c.validUntil) })),
      technicalCertificateIds: new Set(technical.map((t) => t.id)),
    };
  }

  private evaluate(
    row: ProcurementOpportunity,
    requirements: RequirementRow[],
    context: ReadinessContext,
  ): ProcurementReadiness {
    return procurementReadiness({
      ...context,
      sessionDate: row.sessionDate ? toDateKey(row.sessionDate) : null,
      requirements: requirements.map((r) => ({
        id: r.id,
        type: r.type,
        description: r.description,
        certificateType: r.certificateType,
        requiredCnae: r.requiredCnae,
        technicalCertificateId: r.technicalCertificateId,
        manuallyMet: r.manuallyMet,
      })),
    });
  }

  private async requirementWithCheck(organizationId: string, opportunityId: string, requirementId: string): Promise<RequirementView> {
    const detail = await this.getOpportunity(organizationId, opportunityId);
    const view = detail.requirements.find((r) => r.id === requirementId);
    if (!view) throw new NotFoundException('Requisito não encontrado');
    return view;
  }

  /** Cada tipo usa só os seus campos (o banco também garante por CHECK). */
  private async requirementFields(
    organizationId: string,
    type: ProcurementRequirementType,
    dto: { certificateType?: CertificateType; requiredCnae?: string; technicalCertificateId?: string },
  ): Promise<Pick<ProcurementRequirement, 'certificateType' | 'requiredCnae' | 'technicalCertificateId'>> {
    const none = { certificateType: null, requiredCnae: null, technicalCertificateId: null };
    if (type === 'CERTIDAO') {
      if (!dto.certificateType) throw new BadRequestException('Informe o tipo de certidão');
      return { ...none, certificateType: dto.certificateType };
    }
    if (type === 'CNAE') {
      const cnae = dto.requiredCnae ? normalizeCnae(dto.requiredCnae) : null;
      if (!cnae) throw new BadRequestException('CNAE inválido (formato 0000-0/00)');
      return { ...none, requiredCnae: cnae };
    }
    if (type === 'ATESTADO' && dto.technicalCertificateId) {
      const exists = await this.prisma.technicalCertificate.findFirst({
        where: { id: dto.technicalCertificateId, organizationId },
        select: { id: true },
      });
      if (!exists) throw new NotFoundException('Atestado não encontrado');
      return { ...none, technicalCertificateId: dto.technicalCertificateId };
    }
    return none;
  }

  private async findOpportunity(organizationId: string, id: string): Promise<ProcurementOpportunity> {
    const row = await this.prisma.procurementOpportunity.findFirst({ where: { id, organizationId } });
    if (!row) throw new NotFoundException('Licitação não encontrada');
    return row;
  }

  private async findOpenOpportunity(organizationId: string, id: string): Promise<ProcurementOpportunity> {
    const row = await this.findOpportunity(organizationId, id);
    if (!isProcurementOpen(row.status)) throw new ConflictException('Licitação encerrada: o checklist não muda mais');
    return row;
  }

  private async findRequirement(organizationId: string, opportunityId: string, id: string): Promise<ProcurementRequirement> {
    const row = await this.prisma.procurementRequirement.findFirst({ where: { id, opportunityId, organizationId } });
    if (!row) throw new NotFoundException('Requisito não encontrado');
    return row;
  }

  private toSummary(row: ProcurementOpportunity, readiness: ProcurementReadiness): OpportunitySummary {
    return {
      id: row.id,
      agency: row.agency,
      agencyCode: row.agencyCode,
      processNumber: row.processNumber,
      modality: row.modality,
      object: row.object,
      sessionDate: row.sessionDate ? toDateKey(row.sessionDate) : null,
      proposalDeadline: row.proposalDeadline ? toDateKey(row.proposalDeadline) : null,
      estimatedValueCents: row.estimatedValueCents,
      status: row.status,
      statusChangedAt: row.statusChangedAt.toISOString(),
      converted: row.contractId !== null,
      readiness: {
        score: readiness.score,
        metCount: readiness.metCount,
        total: readiness.total,
        blockerCount: readiness.blockers.length,
        ready: readiness.ready,
      },
    };
  }

  private audit(organizationId: string, actor: OpsGovActor, action: string, resource: string, metadata: Record<string, unknown>) {
    return this.auditService.log({
      actorType: actor.type,
      actorId: actor.id,
      organizationId,
      action,
      resource,
      metadata: metadata as Prisma.InputJsonValue,
    });
  }
}

function contractTitle(row: ProcurementOpportunity): string {
  const ref = row.processNumber ? ` ${row.processNumber}` : '';
  return `Licitação${ref}: ${row.agency}`.slice(0, 200);
}

function toRequirementView(row: RequirementRow, met: boolean, reason: string): RequirementView {
  return {
    id: row.id,
    type: row.type,
    description: row.description,
    certificateType: row.certificateType,
    requiredCnae: row.requiredCnae,
    technicalCertificate: row.technicalCertificate,
    manuallyMet: row.manuallyMet,
    documentId: row.documentId,
    source: row.source,
    notes: row.notes,
    met,
    reason,
  };
}
