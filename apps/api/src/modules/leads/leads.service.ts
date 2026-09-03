import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Customer, Lead, LeadStatus, Prisma } from '@opsmind/database';
import {
  QUALIFICATION_THRESHOLD,
  scoreLead,
  type LeadScoringInput,
  type ServiceOfferingIcp,
} from '@opsmind/shared-types';
import { EXPLORIUM_GATEWAY, type ExploriumGateway } from '@opsmind/integrations';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { ListLeadsQueryDto } from './dto/list-leads-query.dto';
import { ConvertLeadDto } from './dto/convert-lead.dto';

export interface ListLeadsFilter {
  status?: ListLeadsQueryDto['status'];
  sourceType?: ListLeadsQueryDto['sourceType'];
  minScore?: number;
  city?: string;
  state?: string;
  hasWebsite?: boolean;
  search?: string;
}

// Mesmo racional de `PRE_OUTREACH_DRAFTED_STATUSES` em `outreach.service.ts`:
// só nesses status `score()` (e, por consequência, `enrich()`, que termina
// chamando `score()`) tem permissão de ESCREVER `Lead.status` — nunca regride
// um lead que já avançou no pipeline (OUTREACH_DRAFTED em diante, incluindo
// CONTACTED/REPLIED/CONVERTED/LOST) de volta para QUALIFIED/DISQUALIFIED só
// porque alguém pediu um re-score/re-enrich. Sem essa guarda, um lead
// CONVERTED (convertedCustomerId já setado) reescorado voltaria a
// `status: 'QUALIFIED'`, uma linha inconsistente (convertido, mas "não
// convertido" pelo status). `score`/`scoreBreakdown`/`suggestedOfferingId`
// continuam sendo atualizados sempre — são metadados de pontuação, não
// estado de ciclo de vida, então recalculá-los não tem o mesmo risco.
const PRE_QUALIFICATION_STATUSES: LeadStatus[] = ['DISCOVERED', 'QUALIFIED', 'DISQUALIFIED'];

// Tipo do enrichment gravado por `enrich()` — mesmo formato usado por
// `apps/worker/src/lead-scrape-processor.ts` (`type: 'explorium_firmographics'`,
// `data` = `ExploriumBusinessResult` bruto) para que `getFirmographics` leia
// o enrichment mais recente independentemente de ter sido gravado pelo
// worker (scrape em lote) ou por este service (enrich sob demanda).
interface ExploriumFirmographicsData {
  industry?: string | null;
  employeeCount?: number | null;
  revenueUsd?: number | null;
}

function toOfferingIcp(o: {
  id: string;
  signals: string[];
  targetIndustries: string[];
  minEmployees: number | null;
  maxEmployees: number | null;
  minRevenueUsd: number | null;
  maxRevenueUsd: number | null;
}): ServiceOfferingIcp {
  return {
    id: o.id,
    signals: o.signals,
    targetIndustries: o.targetIndustries,
    minEmployees: o.minEmployees,
    maxEmployees: o.maxEmployees,
    minRevenueUsd: o.minRevenueUsd,
    maxRevenueUsd: o.maxRevenueUsd,
  };
}

/**
 * Sem repository layer — chama `PrismaService` diretamente, mesmo padrão de
 * `CustomersService`.
 */
@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    @Inject(EXPLORIUM_GATEWAY) private readonly exploriumGateway: ExploriumGateway,
  ) {}

  async create(organizationId: string, dto: CreateLeadDto, actorUserId: string): Promise<Lead> {
    const lead = await this.prisma.lead.create({
      data: {
        organizationId,
        sourceType: 'MANUAL',
        actorType: 'USER',
        actorId: actorUserId,
        ...dto,
      },
    });

    await this.auditService.log({
      actorType: 'USER',
      actorId: actorUserId,
      organizationId,
      action: 'lead.created',
      resource: `Lead:${lead.id}`,
    });

    return lead;
  }

  async findByIdOrThrow(organizationId: string, id: string): Promise<Lead> {
    const lead = await this.prisma.lead.findFirst({
      where: { id, organizationId },
      include: { enrichments: true, outreachMessages: true },
    });
    if (!lead) {
      throw new NotFoundException('Lead não encontrado');
    }
    return lead;
  }

  list(organizationId: string, filter: ListLeadsFilter): Promise<Lead[]> {
    return this.prisma.lead.findMany({
      where: {
        organizationId,
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.sourceType ? { sourceType: filter.sourceType } : {}),
        ...(filter.minScore !== undefined ? { score: { gte: filter.minScore } } : {}),
        ...(filter.city ? { city: { equals: filter.city, mode: 'insensitive' as const } } : {}),
        ...(filter.state ? { state: { equals: filter.state, mode: 'insensitive' as const } } : {}),
        ...(filter.hasWebsite === true ? { website: { not: null } } : {}),
        ...(filter.hasWebsite === false ? { website: null } : {}),
        ...(filter.search
          ? {
              OR: [
                { name: { contains: filter.search, mode: 'insensitive' as const } },
                { rawContent: { contains: filter.search, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      orderBy: { discoveredAt: 'desc' },
    });
  }

  async update(
    organizationId: string,
    id: string,
    dto: UpdateLeadDto,
    actorUserId: string,
  ): Promise<Lead> {
    await this.findByIdOrThrow(organizationId, id);

    const updated = await this.prisma.lead.update({ where: { id }, data: dto });

    await this.auditService.log({
      actorType: 'USER',
      actorId: actorUserId,
      organizationId,
      action: 'lead.updated',
      resource: `Lead:${id}`,
      metadata: { ...dto },
    });

    return updated;
  }

  /**
   * `POST .../leads/:leadId/score` — recalcula `score`/`scoreBreakdown`/
   * `status` via `scoreLead()` (função pura, `@opsmind/shared-types`), a
   * MESMA usada por `apps/worker/src/lead-scrape-processor.ts` no scraping em
   * lote — nunca diverge entre os dois caminhos. Só as `ServiceOffering`
   * ativas entram no cálculo, mesmo filtro do worker. Firmographics vêm do
   * `LeadEnrichment` mais recente do tipo `explorium_firmographics`, se
   * existir (ver `getFirmographics`).
   */
  async score(organizationId: string, id: string, actorUserId: string): Promise<Lead> {
    const lead = await this.findByIdOrThrow(organizationId, id);

    const offerings = await this.prisma.serviceOffering.findMany({
      where: { organizationId, isActive: true },
    });
    const firmographics = await this.getFirmographics(organizationId, id);

    const scoreInput: LeadScoringInput = {
      website: lead.website,
      googleCategory: lead.googleCategory,
      rating: lead.rating ? Number(lead.rating) : null,
      reviewCount: lead.reviewCount,
      rawContent: lead.rawContent,
      firmographics,
    };
    const breakdown = scoreLead(scoreInput, offerings.map(toOfferingIcp));
    const computedStatus: LeadStatus = breakdown.total >= QUALIFICATION_THRESHOLD ? 'QUALIFIED' : 'DISQUALIFIED';
    // Ver comentário de `PRE_QUALIFICATION_STATUSES` no topo do arquivo.
    const canUpdateStatus = PRE_QUALIFICATION_STATUSES.includes(lead.status);

    const updated = await this.prisma.lead.update({
      where: { id },
      data: {
        score: breakdown.total,
        scoreBreakdown: breakdown as unknown as Prisma.InputJsonValue,
        ...(canUpdateStatus ? { status: computedStatus } : {}),
        suggestedOfferingId: breakdown.matchedOfferingId,
      },
    });

    await this.auditService.log({
      actorType: 'USER',
      actorId: actorUserId,
      organizationId,
      action: 'lead.scored',
      resource: `Lead:${id}`,
      metadata: { score: breakdown.total, status: canUpdateStatus ? computedStatus : lead.status },
    });

    return updated;
  }

  /**
   * `POST .../leads/:leadId/enrich` — enrichment sob demanda de UM lead
   * (fora do fluxo de scrape em massa, que já enriquece via
   * `NEEDS_MATCH_ENRICHMENT` no worker): chama `ExploriumGateway.matchBusiness`
   * diretamente, grava o resultado como `LeadEnrichment` (mesmo `type` que o
   * worker usa, `explorium_firmographics`, para que `score()` leia os dois
   * casos sem distinção) e recalcula o score em seguida.
   */
  async enrich(organizationId: string, id: string, actorUserId: string): Promise<Lead> {
    const lead = await this.findByIdOrThrow(organizationId, id);

    const match = await this.exploriumGateway.matchBusiness(lead.name, lead.address, lead.website);
    if (match) {
      await this.prisma.leadEnrichment.create({
        data: {
          organizationId,
          leadId: id,
          type: 'explorium_firmographics',
          data: match as unknown as Prisma.InputJsonValue,
          actorType: 'USER',
          actorId: actorUserId,
        },
      });
    }

    await this.auditService.log({
      actorType: 'USER',
      actorId: actorUserId,
      organizationId,
      action: 'lead.enriched',
      resource: `Lead:${id}`,
      metadata: { matched: match !== null },
    });

    return this.score(organizationId, id, actorUserId);
  }

  /**
   * `POST .../leads/:leadId/convert` — promove o Lead a `Customer`.
   * Cria o `Customer` PRIMEIRO; se a guarda de corrida abaixo (`updateMany`
   * condicional no WHERE, mesmo padrão de `OutreachService.applyTransition`)
   * perder uma conversão concorrente do mesmo lead e lançar, a transação de
   * request inteira (aberta pelo `TenantContextInterceptor` global) é
   * revertida pelo Nest/Prisma — este `create()` nunca fica "pendurado" sem
   * o `Lead` correspondente ter sido de fato marcado `CONVERTED`.
   */
  async convertToCustomer(
    organizationId: string,
    leadId: string,
    dto: ConvertLeadDto,
    actorUserId: string,
  ): Promise<Customer> {
    const lead = await this.findByIdOrThrow(organizationId, leadId);
    if (lead.convertedCustomerId) {
      throw new ConflictException('Lead já foi convertido em cliente');
    }

    const customer = await this.prisma.customer.create({
      data: {
        organizationId,
        name: dto.name ?? lead.name,
        company: dto.company ?? lead.name,
        phone: lead.phone,
        email: lead.email,
        status: 'LEAD',
      },
    });

    const { count } = await this.prisma.lead.updateMany({
      where: { id: leadId, organizationId, convertedCustomerId: null },
      data: { status: 'CONVERTED', convertedCustomerId: customer.id },
    });
    if (count === 0) {
      throw new ConflictException('Lead já foi convertido em cliente');
    }

    await this.auditService.log({
      actorType: 'USER',
      actorId: actorUserId,
      organizationId,
      action: 'lead.converted',
      resource: `Lead:${leadId}`,
      metadata: { customerId: customer.id },
    });

    return customer;
  }

  private async getFirmographics(
    organizationId: string,
    leadId: string,
  ): Promise<LeadScoringInput['firmographics']> {
    const enrichment = await this.prisma.leadEnrichment.findFirst({
      where: { organizationId, leadId, type: 'explorium_firmographics' },
      orderBy: { createdAt: 'desc' },
    });
    if (!enrichment) {
      return null;
    }
    const data = enrichment.data as unknown as ExploriumFirmographicsData;
    return {
      industry: data.industry ?? null,
      employeeCount: data.employeeCount ?? null,
      revenueUsd: data.revenueUsd ?? null,
    };
  }
}
