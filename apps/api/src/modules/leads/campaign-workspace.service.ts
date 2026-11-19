import { Injectable } from '@nestjs/common';
import type { CampaignLeadOrigin, LeadEntityType, LeadStatus, OutreachStatus, Prisma } from '@opsmind/database';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { CampaignsService } from '../harvey/campaigns.service';
import type { CampaignLeadsQueryDto, CampaignMessagesQueryDto } from './dto/campaign-leads-query.dto';

const PAST_QUALIFICATION: LeadStatus[] = [
  'QUALIFIED',
  'OUTREACH_DRAFTED',
  'OUTREACH_APPROVED',
  'CONTACTED',
  'REPLIED',
  'CONVERTED',
  'LOST',
];

const MESSAGE_SELECT = {
  id: true,
  channel: true,
  subject: true,
  body: true,
  status: true,
  strategy: true,
  createdAt: true,
  approvedAt: true,
  sentAt: true,
  repliedAt: true,
  rejectedReason: true,
  lead: { select: { id: true, name: true } },
} satisfies Prisma.OutreachMessageSelect;

const PARTICIPATION_SELECT = {
  origin: true,
  firstFoundAt: true,
  lastFoundAt: true,
  timesFound: true,
  campaign: { select: { id: true, name: true, kind: true, status: true } },
} satisfies Prisma.CampaignLeadSelect;

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CampaignLeadRow {
  id: string;
  name: string;
  googleCategory: string | null;
  city: string | null;
  state: string | null;
  phone: string | null;
  whatsapp: string | null;
  website: string | null;
  score: number | null;
  status: LeadStatus;
  entityType: LeadEntityType;
  disqualificationReason: string | null;
  duplicateOfLeadId: string | null;
  discoveredAt: Date;
  latestOutreachStatus: OutreachStatus | null;
  participation: { origin: CampaignLeadOrigin; firstFoundAt: Date; lastFoundAt: Date; timesFound: number };
}

export type CampaignMessageRow = Prisma.OutreachMessageGetPayload<{ select: typeof MESSAGE_SELECT }>;
export type LeadParticipation = Prisma.CampaignLeadGetPayload<{ select: typeof PARTICIPATION_SELECT }>;

// Leitura de uma campanha: leads (pela participação em CampaignLead, com
// histórico) e mensagens geradas nela. Sempre escopado pela organização.
@Injectable()
export class CampaignWorkspaceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly campaignsService: CampaignsService,
  ) {}

  async leads(organizationId: string, campaignId: string, query: CampaignLeadsQueryDto): Promise<Paginated<CampaignLeadRow>> {
    await this.campaignsService.findByIdOrThrow(organizationId, campaignId);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const order = query.order ?? 'desc';
    const leadWhere: Prisma.LeadWhereInput = {
      organizationId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.qualification === 'qualified' ? { status: { in: PAST_QUALIFICATION } } : {}),
      ...(query.qualification === 'disqualified' ? { status: 'DISQUALIFIED' } : {}),
      ...(query.qualification === 'pending' ? { status: 'DISCOVERED' } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.minScore !== undefined ? { score: { gte: query.minScore } } : {}),
      ...(query.hasWebsite === true ? { website: { not: null } } : {}),
      ...(query.hasWebsite === false ? { website: null } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search.trim(), mode: 'insensitive' } },
              { googleCategory: { contains: query.search.trim(), mode: 'insensitive' } },
              { phone: { contains: query.search.trim() } },
            ],
          }
        : {}),
    };
    const where: Prisma.CampaignLeadWhereInput = { organizationId, campaignId, lead: leadWhere };
    const orderBy: Prisma.CampaignLeadOrderByWithRelationInput[] =
      query.sort === 'name'
        ? [{ lead: { name: order } }]
        : query.sort === 'discoveredAt'
          ? [{ lead: { discoveredAt: order } }]
          : query.sort === 'lastFoundAt'
            ? [{ lastFoundAt: order }]
            : [{ lead: { score: { sort: order, nulls: 'last' } } }, { lead: { name: 'asc' } }];
    const [total, rows] = await Promise.all([
      this.prisma.campaignLead.count({ where }),
      this.prisma.campaignLead.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          lead: {
            select: {
              id: true,
              name: true,
              googleCategory: true,
              city: true,
              state: true,
              phone: true,
              whatsapp: true,
              website: true,
              score: true,
              status: true,
              entityType: true,
              disqualificationReason: true,
              duplicateOfLeadId: true,
              discoveredAt: true,
              outreachMessages: { orderBy: { createdAt: 'desc' }, take: 1, select: { status: true, campaignId: true } },
            },
          },
        },
      }),
    ]);
    return {
      items: rows.map(({ lead: { outreachMessages, ...lead }, ...participation }) => ({
        ...lead,
        latestOutreachStatus: outreachMessages[0]?.status ?? null,
        participation: {
          origin: participation.origin,
          firstFoundAt: participation.firstFoundAt,
          lastFoundAt: participation.lastFoundAt,
          timesFound: participation.timesFound,
        },
      })),
      total,
      page,
      pageSize,
    };
  }

  async messages(
    organizationId: string,
    campaignId: string,
    query: CampaignMessagesQueryDto,
  ): Promise<Paginated<CampaignMessageRow>> {
    await this.campaignsService.findByIdOrThrow(organizationId, campaignId);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const where: Prisma.OutreachMessageWhereInput = {
      organizationId,
      campaignId,
      ...(query.status ? { status: query.status } : {}),
    };
    const [total, items] = await Promise.all([
      this.prisma.outreachMessage.count({ where }),
      this.prisma.outreachMessage.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: MESSAGE_SELECT,
      }),
    ]);
    return { items, total, page, pageSize };
  }

  // Em quais campanhas uma empresa apareceu (histórico de participação).
  participations(organizationId: string, leadId: string): Promise<LeadParticipation[]> {
    return this.prisma.campaignLead.findMany({
      where: { organizationId, leadId },
      orderBy: { firstFoundAt: 'asc' },
      select: PARTICIPATION_SELECT,
    });
  }
}
