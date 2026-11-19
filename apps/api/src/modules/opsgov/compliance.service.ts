import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Certificate, ComplianceObligation, Prisma } from '@opsmind/database';
import {
  certificateStatus,
  daysBetween,
  firstDueDateFrom,
  fromDateKey,
  nextDueDate,
  toDateKey,
  todayInSaoPaulo,
  type CertificateStatus,
  type CertificateType,
} from '@opsmind/shared-types';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { assertDocumentOfOrganization } from './assert-document';
import type {
  CompleteObligationDto,
  CreateCertificateDto,
  CreateObligationDto,
  DismissObligationDto,
  UpdateCertificateDto,
  UpdateObligationDto,
} from './dto/compliance.dto';
import type { OpsGovActor } from './opsgov.types';

export interface ObligationView {
  id: string;
  type: ComplianceObligation['type'];
  title: string;
  recurrence: ComplianceObligation['recurrence'];
  dueDay: number | null;
  dueMonth: number | null;
  nextDueDate: string;
  daysUntilDue: number;
  status: ComplianceObligation['status'];
  notes: string | null;
  lastCompletion: { dueDate: string; completedOn: string; documentId: string | null } | null;
}

export interface CertificateView {
  id: string;
  type: CertificateType;
  issuer: string | null;
  code: string | null;
  issuedOn: string;
  validUntil: string;
  daysUntilExpiry: number;
  status: CertificateStatus;
  /** A mais recente do tipo (maior validade) — as anteriores são histórico. */
  isCurrent: boolean;
  notes: string | null;
  documentId: string | null;
}

/**
 * Obrigações e certidões. Toda mudança é ação humana via HTTP (WRITE_ROLES):
 * cumprir uma obrigação grava o histórico e avança o vencimento pela regra;
 * certidão nunca tem status gravado — é calculado a partir da validade.
 */
@Injectable()
export class ComplianceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async listObligations(organizationId: string, today = todayInSaoPaulo()): Promise<ObligationView[]> {
    const rows = await this.prisma.complianceObligation.findMany({
      where: { organizationId },
      include: { completions: { orderBy: { dueDate: 'desc' }, take: 1 } },
      orderBy: [{ status: 'asc' }, { nextDueDate: 'asc' }],
    });
    return rows.map((row) => this.toObligationView(row, row.completions[0] ?? null, today));
  }

  async createObligation(organizationId: string, dto: CreateObligationDto, actor: OpsGovActor): Promise<ObligationView> {
    const rule = {
      recurrence: dto.recurrence,
      dueDay: dto.recurrence === 'ONCE' ? null : (dto.dueDay ?? null),
      dueMonth: dto.recurrence === 'YEARLY' ? (dto.dueMonth ?? null) : null,
    };
    if (rule.recurrence !== 'ONCE' && rule.dueDay === null) {
      throw new BadRequestException('Obrigação recorrente precisa do dia do vencimento');
    }
    if (rule.recurrence === 'YEARLY' && rule.dueMonth === null) {
      throw new BadRequestException('Obrigação anual precisa do mês do vencimento');
    }
    const first = dto.firstDueDate ?? firstDueDateFrom(rule, todayInSaoPaulo());
    if (!first) throw new BadRequestException('Informe a data do vencimento');

    const row = await this.prisma.complianceObligation.create({
      data: {
        organizationId,
        type: dto.type,
        title: dto.title.trim(),
        ...rule,
        nextDueDate: fromDateKey(first),
        notes: dto.notes ?? null,
        actorType: actor.type,
        actorId: actor.id,
      },
    });
    await this.audit(organizationId, actor, 'opsgov.obligation.created', `ComplianceObligation:${row.id}`, {
      type: row.type,
      nextDueDate: first,
    });
    return this.toObligationView(row, null);
  }

  async updateObligation(
    organizationId: string,
    id: string,
    dto: UpdateObligationDto,
    actor: OpsGovActor,
  ): Promise<ObligationView> {
    const current = await this.getObligation(organizationId, id);
    if (current.status !== 'PENDENTE') throw new ConflictException('Só obrigações pendentes podem ser alteradas');
    const row = await this.prisma.complianceObligation.update({
      where: { id: current.id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        ...(dto.nextDueDate !== undefined ? { nextDueDate: fromDateKey(dto.nextDueDate) } : {}),
      },
    });
    await this.audit(organizationId, actor, 'opsgov.obligation.updated', `ComplianceObligation:${row.id}`, {
      ...(dto.nextDueDate ? { from: toDateKey(current.nextDueDate), to: dto.nextDueDate } : {}),
    });
    return this.toObligationView(row, null);
  }

  /** Cumpre o vencimento atual: grava o histórico e avança (ou encerra, se única). */
  async completeObligation(
    organizationId: string,
    id: string,
    dto: CompleteObligationDto,
    actor: OpsGovActor,
  ): Promise<ObligationView> {
    await assertDocumentOfOrganization(this.prisma, organizationId, dto.documentId);

    const { row, completion } = await this.prisma.runInTransaction(async (tx) => {
      // Trava a linha: dois cliques simultâneos não cumprem o mesmo vencimento duas vezes.
      await tx.$queryRaw`SELECT id FROM compliance_obligations WHERE id = ${id} FOR UPDATE`;
      const current = await tx.complianceObligation.findFirst({ where: { id, organizationId } });
      if (!current) throw new NotFoundException('Obrigação não encontrada');
      if (current.status !== 'PENDENTE') throw new ConflictException('Esta obrigação não está pendente');

      const dueDate = toDateKey(current.nextDueDate);
      const completion = await tx.complianceObligationCompletion.create({
        data: {
          organizationId,
          obligationId: current.id,
          dueDate: current.nextDueDate,
          completedOn: fromDateKey(dto.completedOn ?? todayInSaoPaulo()),
          notes: dto.notes ?? null,
          documentId: dto.documentId ?? null,
          actorType: actor.type,
          actorId: actor.id,
        },
      });
      const next = nextDueDate(current, dueDate);
      const row = await tx.complianceObligation.update({
        where: { id: current.id },
        data: next ? { nextDueDate: fromDateKey(next) } : { status: 'CUMPRIDA' },
      });
      return { row, completion };
    });

    await this.audit(organizationId, actor, 'opsgov.obligation.completed', `ComplianceObligation:${row.id}`, {
      dueDate: toDateKey(completion.dueDate),
      nextDueDate: row.status === 'PENDENTE' ? toDateKey(row.nextDueDate) : null,
    });
    return this.toObligationView(row, completion);
  }

  async dismissObligation(
    organizationId: string,
    id: string,
    dto: DismissObligationDto,
    actor: OpsGovActor,
  ): Promise<ObligationView> {
    const current = await this.getObligation(organizationId, id);
    if (current.status !== 'PENDENTE') throw new ConflictException('Esta obrigação não está pendente');
    const notes = [current.notes, `Dispensada: ${dto.reason.trim()}`].filter(Boolean).join('\n');
    const row = await this.prisma.complianceObligation.update({
      where: { id: current.id },
      data: { status: 'DISPENSADA', notes },
    });
    await this.audit(organizationId, actor, 'opsgov.obligation.dismissed', `ComplianceObligation:${row.id}`, {
      reason: dto.reason,
    });
    return this.toObligationView(row, null);
  }

  async listCertificates(organizationId: string, today = todayInSaoPaulo()): Promise<CertificateView[]> {
    const rows = await this.prisma.certificate.findMany({
      where: { organizationId },
      orderBy: [{ type: 'asc' }, { validUntil: 'desc' }, { createdAt: 'desc' }],
    });
    const seen = new Set<CertificateType>();
    return rows.map((row) => {
      const isCurrent = !seen.has(row.type);
      seen.add(row.type);
      return this.toCertificateView(row, isCurrent, today);
    });
  }

  async createCertificate(organizationId: string, dto: CreateCertificateDto, actor: OpsGovActor): Promise<CertificateView> {
    if (dto.validUntil < dto.issuedOn) throw new BadRequestException('A validade não pode ser anterior à emissão');
    await assertDocumentOfOrganization(this.prisma, organizationId, dto.documentId);
    const row = await this.prisma.certificate.create({
      data: {
        organizationId,
        type: dto.type,
        issuer: dto.issuer?.trim() || null,
        code: dto.code?.trim() || null,
        issuedOn: fromDateKey(dto.issuedOn),
        validUntil: fromDateKey(dto.validUntil),
        notes: dto.notes ?? null,
        documentId: dto.documentId ?? null,
        actorType: actor.type,
        actorId: actor.id,
      },
    });
    await this.audit(organizationId, actor, 'opsgov.certificate.created', `Certificate:${row.id}`, {
      type: row.type,
      validUntil: dto.validUntil,
    });
    const current = (await this.listCertificates(organizationId)).find((c) => c.id === row.id);
    return current ?? this.toCertificateView(row, false);
  }

  // Validade e emissão não mudam depois de registradas: certidão nova = nova linha.
  async updateCertificate(
    organizationId: string,
    id: string,
    dto: UpdateCertificateDto,
    actor: OpsGovActor,
  ): Promise<CertificateView> {
    const current = await this.prisma.certificate.findFirst({ where: { id, organizationId } });
    if (!current) throw new NotFoundException('Certidão não encontrada');
    await assertDocumentOfOrganization(this.prisma, organizationId, dto.documentId);
    await this.prisma.certificate.update({
      where: { id: current.id },
      data: {
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        ...(dto.documentId !== undefined ? { documentId: dto.documentId } : {}),
      },
    });
    await this.audit(organizationId, actor, 'opsgov.certificate.updated', `Certificate:${current.id}`, {});
    return (await this.listCertificates(organizationId)).find((c) => c.id === current.id)!;
  }

  private async getObligation(organizationId: string, id: string): Promise<ComplianceObligation> {
    const row = await this.prisma.complianceObligation.findFirst({ where: { id, organizationId } });
    if (!row) throw new NotFoundException('Obrigação não encontrada');
    return row;
  }

  private toObligationView(
    row: ComplianceObligation,
    completion: { dueDate: Date; completedOn: Date; documentId: string | null } | null,
    today = todayInSaoPaulo(),
  ): ObligationView {
    const nextDue = toDateKey(row.nextDueDate);
    return {
      id: row.id,
      type: row.type,
      title: row.title,
      recurrence: row.recurrence,
      dueDay: row.dueDay,
      dueMonth: row.dueMonth,
      nextDueDate: nextDue,
      daysUntilDue: daysBetween(today, nextDue),
      status: row.status,
      notes: row.notes,
      lastCompletion: completion
        ? { dueDate: toDateKey(completion.dueDate), completedOn: toDateKey(completion.completedOn), documentId: completion.documentId }
        : null,
    };
  }

  private toCertificateView(row: Certificate, isCurrent: boolean, today = todayInSaoPaulo()): CertificateView {
    const validUntil = toDateKey(row.validUntil);
    return {
      id: row.id,
      type: row.type,
      issuer: row.issuer,
      code: row.code,
      issuedOn: toDateKey(row.issuedOn),
      validUntil,
      daysUntilExpiry: daysBetween(today, validUntil),
      status: certificateStatus(validUntil, today),
      isCurrent,
      notes: row.notes,
      documentId: row.documentId,
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
