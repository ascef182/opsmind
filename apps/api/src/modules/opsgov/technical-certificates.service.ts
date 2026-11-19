import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@opsmind/database';
import { fromDateKey, toDateKey, type RevenueGroup } from '@opsmind/shared-types';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { assertDocumentOfOrganization } from './assert-document';
import type { CreateTechnicalCertificateDto, UpdateTechnicalCertificateDto } from './dto/procurement.dto';
import type { OpsGovActor } from './opsgov.types';

export interface TechnicalCertificateView {
  id: string;
  issuer: string;
  object: string;
  periodStart: string;
  periodEnd: string | null;
  valueCents: number | null;
  companyActivity: { id: string; cnae: string; description: string; revenueGroup: RevenueGroup } | null;
  customer: { id: string; name: string } | null;
  contractId: string | null;
  documentId: string | null;
  notes: string | null;
  createdAt: string;
}

const INCLUDE = {
  companyActivity: { select: { id: true, cnae: true, description: true, revenueGroup: true } },
  customer: { select: { id: true, name: true } },
} satisfies Prisma.TechnicalCertificateInclude;

type Row = Prisma.TechnicalCertificateGetPayload<{ include: typeof INCLUDE }>;

/** Atestados de capacidade técnica. O conteúdo é o que o emissor declarou e não é editado. */
@Injectable()
export class TechnicalCertificatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async list(organizationId: string): Promise<TechnicalCertificateView[]> {
    const rows = await this.prisma.technicalCertificate.findMany({
      where: { organizationId },
      include: INCLUDE,
      orderBy: [{ periodStart: 'desc' }, { createdAt: 'desc' }],
    });
    return rows.map(toView);
  }

  async create(
    organizationId: string,
    dto: CreateTechnicalCertificateDto,
    actor: OpsGovActor,
  ): Promise<TechnicalCertificateView> {
    if (dto.periodEnd && dto.periodEnd < dto.periodStart) {
      throw new BadRequestException('O fim do período não pode ser anterior ao início');
    }
    await this.assertLinks(organizationId, dto);
    const row = await this.prisma.technicalCertificate.create({
      data: {
        organizationId,
        issuer: dto.issuer.trim(),
        object: dto.object.trim(),
        periodStart: fromDateKey(dto.periodStart),
        periodEnd: dto.periodEnd ? fromDateKey(dto.periodEnd) : null,
        valueCents: dto.valueCents ?? null,
        companyActivityId: dto.companyActivityId ?? null,
        customerId: dto.customerId ?? null,
        contractId: dto.contractId ?? null,
        documentId: dto.documentId ?? null,
        notes: dto.notes ?? null,
        actorType: actor.type,
        actorId: actor.id,
      },
      include: INCLUDE,
    });
    await this.audit(organizationId, actor, 'opsgov.technical_certificate.created', row.id, { issuer: row.issuer });
    return toView(row);
  }

  async update(
    organizationId: string,
    id: string,
    dto: UpdateTechnicalCertificateDto,
    actor: OpsGovActor,
  ): Promise<TechnicalCertificateView> {
    const current = await this.prisma.technicalCertificate.findFirst({ where: { id, organizationId } });
    if (!current) throw new NotFoundException('Atestado não encontrado');
    await this.assertLinks(organizationId, {
      companyActivityId: dto.companyActivityId ?? undefined,
      documentId: dto.documentId,
    });
    const row = await this.prisma.technicalCertificate.update({
      where: { id: current.id },
      data: {
        ...(dto.companyActivityId !== undefined ? { companyActivityId: dto.companyActivityId } : {}),
        ...(dto.documentId !== undefined ? { documentId: dto.documentId } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      },
      include: INCLUDE,
    });
    await this.audit(organizationId, actor, 'opsgov.technical_certificate.updated', row.id, {
      ...(dto.companyActivityId !== undefined ? { companyActivityId: dto.companyActivityId } : {}),
    });
    return toView(row);
  }

  private async assertLinks(
    organizationId: string,
    links: { companyActivityId?: string; customerId?: string; contractId?: string; documentId?: string },
  ): Promise<void> {
    await assertDocumentOfOrganization(this.prisma, organizationId, links.documentId);
    if (links.companyActivityId) {
      const activity = await this.prisma.companyActivity.findFirst({
        where: { id: links.companyActivityId, organizationId },
        select: { id: true },
      });
      if (!activity) throw new NotFoundException('Atividade (CNAE) não encontrada');
    }
    if (links.customerId) {
      const customer = await this.prisma.customer.findFirst({
        where: { id: links.customerId, organizationId, deletedAt: null },
        select: { id: true },
      });
      if (!customer) throw new NotFoundException('Cliente não encontrado');
    }
    if (links.contractId) {
      const contract = await this.prisma.contract.findFirst({
        where: { id: links.contractId, organizationId },
        select: { customerId: true },
      });
      if (!contract) throw new NotFoundException('Contrato não encontrado');
      if (links.customerId && contract.customerId !== links.customerId) {
        throw new BadRequestException('O contrato não é deste cliente');
      }
    }
  }

  private audit(organizationId: string, actor: OpsGovActor, action: string, id: string, metadata: Record<string, unknown>) {
    return this.auditService.log({
      actorType: actor.type,
      actorId: actor.id,
      organizationId,
      action,
      resource: `TechnicalCertificate:${id}`,
      metadata: metadata as Prisma.InputJsonValue,
    });
  }
}

function toView(row: Row): TechnicalCertificateView {
  return {
    id: row.id,
    issuer: row.issuer,
    object: row.object,
    periodStart: toDateKey(row.periodStart),
    periodEnd: row.periodEnd ? toDateKey(row.periodEnd) : null,
    valueCents: row.valueCents,
    companyActivity: row.companyActivity,
    customer: row.customer,
    contractId: row.contractId,
    documentId: row.documentId,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
  };
}
