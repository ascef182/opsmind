import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { syncDuplicateCandidates, type LeadDuplicateCandidate, type Prisma } from '@opsmind/database';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { DuplicateCandidatesQueryDto } from './dto/campaign-leads-query.dto';

const LEAD_SUMMARY = {
  id: true,
  name: true,
  city: true,
  state: true,
  phone: true,
  website: true,
  sourceType: true,
  status: true,
  duplicateOfLeadId: true,
  discoveredAt: true,
  _count: { select: { outreachMessages: true } },
} satisfies Prisma.LeadSelect;

export type DuplicateCandidateView = Prisma.LeadDuplicateCandidateGetPayload<{
  include: { leadA: { select: typeof LEAD_SUMMARY }; leadB: { select: typeof LEAD_SUMMARY } };
}>;

// Revisão humana de possíveis duplicatas. Confirmar só marca qual lead é a
// duplicata (sai do trabalho automático); nada é fundido, apagado ou movido.
@Injectable()
export class LeadDuplicatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  list(organizationId: string, query: DuplicateCandidatesQueryDto): Promise<DuplicateCandidateView[]> {
    const inCampaign = query.campaignId ? { campaignLeads: { some: { campaignId: query.campaignId } } } : undefined;
    return this.prisma.leadDuplicateCandidate.findMany({
      where: {
        organizationId,
        status: query.status ?? 'PENDING',
        ...(inCampaign ? { OR: [{ leadA: inCampaign }, { leadB: inCampaign }] } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { leadA: { select: LEAD_SUMMARY }, leadB: { select: LEAD_SUMMARY } },
    });
  }

  async refresh(organizationId: string, userId: string): Promise<{ created: number }> {
    const created = await syncDuplicateCandidates(this.prisma, organizationId);
    await this.audit(organizationId, userId, 'lead_duplicates.refreshed', organizationId, { created });
    return { created };
  }

  async confirm(organizationId: string, candidateId: string, duplicateLeadId: string, userId: string): Promise<LeadDuplicateCandidate> {
    const candidate = await this.findOrThrow(organizationId, candidateId);
    if (candidate.status !== 'PENDING') throw new ConflictException('Este par já foi revisado.');
    if (duplicateLeadId !== candidate.leadAId && duplicateLeadId !== candidate.leadBId) {
      throw new BadRequestException('O lead marcado como duplicata precisa ser um dos dois do par.');
    }
    const keptLeadId = duplicateLeadId === candidate.leadAId ? candidate.leadBId : candidate.leadAId;
    const kept = await this.prisma.lead.findFirst({
      where: { id: keptLeadId, organizationId },
      select: { duplicateOfLeadId: true },
    });
    if (kept?.duplicateOfLeadId) {
      throw new ConflictException('O lead mantido já está marcado como duplicata de outro. Revise aquele par primeiro.');
    }
    await this.prisma.lead.updateMany({
      where: { id: duplicateLeadId, organizationId },
      data: { duplicateOfLeadId: keptLeadId },
    });
    const updated = await this.prisma.leadDuplicateCandidate.update({
      where: { id: candidate.id },
      data: { status: 'CONFIRMED', reviewedByUserId: userId, reviewedAt: new Date() },
    });
    await this.audit(organizationId, userId, 'lead_duplicate.confirmed', candidate.id, { duplicateLeadId, keptLeadId });
    return updated;
  }

  async dismiss(organizationId: string, candidateId: string, userId: string): Promise<LeadDuplicateCandidate> {
    const candidate = await this.findOrThrow(organizationId, candidateId);
    if (candidate.status !== 'PENDING') throw new ConflictException('Este par já foi revisado.');
    const updated = await this.prisma.leadDuplicateCandidate.update({
      where: { id: candidate.id },
      data: { status: 'DISMISSED', reviewedByUserId: userId, reviewedAt: new Date() },
    });
    await this.audit(organizationId, userId, 'lead_duplicate.dismissed', candidate.id, {});
    return updated;
  }

  // Desfaz uma revisão: volta para PENDING e, se tinha sido confirmada,
  // desmarca a duplicata.
  async reopen(organizationId: string, candidateId: string, userId: string): Promise<LeadDuplicateCandidate> {
    const candidate = await this.findOrThrow(organizationId, candidateId);
    if (candidate.status === 'PENDING') return candidate;
    if (candidate.status === 'CONFIRMED') {
      await this.prisma.lead.updateMany({
        where: {
          organizationId,
          OR: [
            { id: candidate.leadAId, duplicateOfLeadId: candidate.leadBId },
            { id: candidate.leadBId, duplicateOfLeadId: candidate.leadAId },
          ],
        },
        data: { duplicateOfLeadId: null },
      });
    }
    const updated = await this.prisma.leadDuplicateCandidate.update({
      where: { id: candidate.id },
      data: { status: 'PENDING', reviewedByUserId: null, reviewedAt: null },
    });
    await this.audit(organizationId, userId, 'lead_duplicate.reopened', candidate.id, { from: candidate.status });
    return updated;
  }

  private async findOrThrow(organizationId: string, id: string): Promise<LeadDuplicateCandidate> {
    const candidate = await this.prisma.leadDuplicateCandidate.findFirst({ where: { id, organizationId } });
    if (!candidate) throw new NotFoundException('Par de duplicata não encontrado');
    return candidate;
  }

  private audit(organizationId: string, userId: string, action: string, id: string, metadata: object) {
    return this.auditService.log({
      actorType: 'USER',
      actorId: userId,
      organizationId,
      action,
      resource: `LeadDuplicateCandidate:${id}`,
      metadata: metadata as Prisma.InputJsonValue,
    });
  }
}
