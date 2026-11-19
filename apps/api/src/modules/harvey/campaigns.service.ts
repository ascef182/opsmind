import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type SalesCampaign } from '@opsmind/database';
import {
  CAMPAIGN_LIFECYCLE,
  campaignDisplayName,
  campaignIdentityKey,
  campaignStateCode,
  cycleDateFor,
  isValidTimezone,
  type CampaignLifecycleAction,
} from '@opsmind/shared-types';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { CampaignOverviewQueryDto, CreateCampaignDto, UpdateCampaignDto } from './dto/campaign.dto';

// Canais com envio real integrado. Os demais não podem ser habilitados numa
// campanha até a integração existir (Fase 3).
export const CONNECTED_CHANNELS = ['EMAIL'] as const;

const COUNTRY_DEFAULTS: Record<string, { language: string; timezone: string }> = {
  US: { language: 'en-US', timezone: 'America/New_York' },
  BR: { language: 'pt-BR', timezone: 'America/Sao_Paulo' },
};

const BR_STATE_CODES = new Set([
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
  'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
]);

// Configuração do Harvey copiada para uma campanha nova: a da campanha de
// prospecção mais recente da organização, ou o padrão do país do estado.
const HARVEY_CONFIG_FIELDS = [
  'country',
  'regionLabel',
  'language',
  'timezone',
  'workingDays',
  'workStartMinute',
  'workEndMinute',
  'dailyResearchGoal',
  'dailyQualifiedGoal',
  'dailyOutreachGoal',
  'enabledChannels',
  'requireFirstContactApproval',
] as const;

export interface CampaignStats {
  leadsFound: number;
  qualified: number;
  disqualified: number;
  pending: number;
  messagesPendingApproval: number;
  messagesApproved: number;
  messagesSent: number;
  messagesReplied: number;
  messagesRejected: number;
}

export type CampaignWithStats = SalesCampaign & { stats: CampaignStats; targetCount: number };

interface StatsRow {
  campaign_id: string;
  leads_found: bigint;
  qualified: bigint;
  disqualified: bigint;
  pending: bigint;
  pending_approval: bigint;
  approved: bigint;
  sent: bigint;
  replied: bigint;
  rejected: bigint;
  targets: bigint;
}

const EMPTY_STATS: CampaignStats = {
  leadsFound: 0,
  qualified: 0,
  disqualified: 0,
  pending: 0,
  messagesPendingApproval: 0,
  messagesApproved: 0,
  messagesSent: 0,
  messagesReplied: 0,
  messagesRejected: 0,
};

@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  list(organizationId: string, includeArchived = false): Promise<SalesCampaign[]> {
    return this.prisma.salesCampaign.findMany({
      where: { organizationId, ...(includeArchived ? {} : { status: { not: 'ARCHIVED' } }) },
      orderBy: [{ kind: 'asc' }, { name: 'asc' }],
    });
  }

  async findByIdOrThrow(organizationId: string, id: string): Promise<SalesCampaign> {
    const campaign = await this.prisma.salesCampaign.findFirst({ where: { id, organizationId } });
    if (!campaign) throw new NotFoundException('Campanha não encontrada');
    return campaign;
  }

  async overview(organizationId: string, query: CampaignOverviewQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const where: Prisma.SalesCampaignWhereInput = {
      organizationId,
      ...(query.status ? { status: query.status } : query.includeArchived ? {} : { status: { not: 'ARCHIVED' } }),
      ...(query.city ? { city: { contains: query.city.trim(), mode: 'insensitive' } } : {}),
      ...(query.segment ? { segment: { contains: query.segment.trim(), mode: 'insensitive' } } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search.trim(), mode: 'insensitive' } },
              { segment: { contains: query.search.trim(), mode: 'insensitive' } },
              { city: { contains: query.search.trim(), mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [total, campaigns, totals] = await Promise.all([
      this.prisma.salesCampaign.count({ where }),
      this.prisma.salesCampaign.findMany({
        where,
        orderBy: [{ kind: 'asc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.organizationTotals(organizationId),
    ]);
    const stats = await this.statsFor(campaigns.map((c) => c.id));
    return {
      items: campaigns.map((campaign) => this.withStats(campaign, stats)),
      total,
      page,
      pageSize,
      totals,
    };
  }

  async detail(organizationId: string, id: string): Promise<CampaignWithStats> {
    const campaign = await this.findByIdOrThrow(organizationId, id);
    return this.withStats(campaign, await this.statsFor([campaign.id]));
  }

  async create(organizationId: string, dto: CreateCampaignDto, userId: string): Promise<SalesCampaign> {
    const segment = dto.segment.trim();
    const city = dto.city.trim();
    const state = campaignStateCode(dto.state);
    const identityKey = campaignIdentityKey(segment, city, state);
    await this.assertNoLiveCampaign(organizationId, identityKey);
    const config = { ...(await this.configTemplate(organizationId, state)), ...this.harveyFields(dto) };
    this.validate(config, null);
    try {
      const campaign = await this.prisma.salesCampaign.create({
        data: {
          ...config,
          organizationId,
          name: dto.name?.trim() || campaignDisplayName(segment, city, state),
          kind: 'STANDARD',
          creationSource: 'USER',
          segment,
          city,
          state,
          identityKey,
        },
      });
      for (const sourceType of dto.sources ?? []) {
        await this.prisma.prospectingTarget.create({
          data: { organizationId, campaignId: campaign.id, city, state, businessType: segment, sourceType },
        });
      }
      await this.audit(organizationId, userId, 'campaign.created', campaign.id, { ...dto });
      return campaign;
    } catch (error) {
      throw this.mapUnique(error);
    }
  }

  async update(organizationId: string, id: string, dto: UpdateCampaignDto, userId: string): Promise<SalesCampaign> {
    const current = await this.findByIdOrThrow(organizationId, id);
    const data = this.validate({ ...dto }, current);
    try {
      const updated = await this.prisma.salesCampaign.update({ where: { id: current.id }, data });
      await this.audit(organizationId, userId, 'campaign.updated', id, { ...dto });
      return updated;
    } catch (error) {
      throw this.mapUnique(error);
    }
  }

  async changeStatus(
    organizationId: string,
    id: string,
    action: CampaignLifecycleAction,
    userId: string,
    now: Date = new Date(),
  ): Promise<SalesCampaign> {
    const current = await this.findByIdOrThrow(organizationId, id);
    if (current.kind !== 'STANDARD') {
      throw new BadRequestException('Só campanhas de prospecção mudam de status.');
    }
    const rule = CAMPAIGN_LIFECYCLE[action];
    if (!rule.from.includes(current.status)) {
      throw new ConflictException(`Não é possível ${ACTION_LABELS[action]} uma campanha com status ${current.status}.`);
    }
    if (rule.to === 'ACTIVE' || rule.to === 'PAUSED') {
      await this.assertNoLiveCampaign(organizationId, current.identityKey!, current.id);
    }
    // Condicional: dois cliques concorrentes não aplicam a mesma transição duas vezes.
    const changed = await this.prisma.salesCampaign.updateMany({
      where: { id: current.id, organizationId, status: current.status },
      data: {
        status: rule.to,
        ...(rule.to === 'COMPLETED' ? { completedAt: now } : {}),
        ...(rule.to === 'ARCHIVED' ? { archivedAt: now } : {}),
        ...(action === 'reopen' ? { completedAt: null } : {}),
      },
    });
    if (changed.count === 0) throw new ConflictException('A campanha mudou de status ao mesmo tempo. Recarregue.');
    await this.syncRuns(current, action, now);
    await this.audit(organizationId, userId, `campaign.${action}`, id, { from: current.status, to: rule.to });
    return this.findByIdOrThrow(organizationId, id);
  }

  // Campanha de uma busca avulsa: reusa a viva com o mesmo segmento + cidade +
  // estado sem mexer na configuração dela; cria uma nova só se não houver.
  async findOrCreateForSearch(
    organizationId: string,
    search: { businessType: string; city: string; state: string },
  ): Promise<SalesCampaign> {
    const segment = search.businessType.trim();
    const city = search.city.trim();
    const state = campaignStateCode(search.state);
    const identityKey = campaignIdentityKey(segment, city, state);
    const live = await this.findLive(organizationId, identityKey);
    if (live) return live;
    const completed = await this.prisma.salesCampaign.findFirst({
      where: { organizationId, kind: 'STANDARD', identityKey, status: 'COMPLETED' },
      orderBy: { completedAt: 'desc' },
    });
    if (completed) {
      throw new ConflictException({
        message: `A campanha "${completed.name}" foi finalizada. Reabra-a para buscar de novo.`,
        campaignId: completed.id,
      });
    }
    const config = await this.configTemplate(organizationId, state);
    try {
      return await this.prisma.salesCampaign.create({
        data: {
          ...config,
          organizationId,
          name: await this.freeName(organizationId, campaignDisplayName(segment, city, state)),
          kind: 'STANDARD',
          creationSource: 'AUTO_FROM_SEARCH',
          segment,
          city,
          state,
          identityKey,
        },
      });
    } catch (error) {
      // Outra request criou a mesma campanha ao mesmo tempo (índice único parcial).
      throw this.mapUnique(error);
    }
  }

  // Campanha de destino dos leads cadastrados à mão (uma por organização).
  async manualEntryCampaign(organizationId: string): Promise<SalesCampaign> {
    const existing = await this.prisma.salesCampaign.findFirst({ where: { organizationId, kind: 'MANUAL_ENTRY' } });
    if (existing) return existing;
    const config = await this.configTemplate(organizationId, null);
    try {
      return await this.prisma.salesCampaign.create({
        data: {
          ...config,
          dailyResearchGoal: 0,
          dailyQualifiedGoal: 0,
          dailyOutreachGoal: 0,
          organizationId,
          name: await this.freeName(organizationId, 'Cadastro manual'),
          kind: 'MANUAL_ENTRY',
          creationSource: 'AUTO_FROM_SEARCH',
        },
      });
    } catch (error) {
      throw this.mapUnique(error);
    }
  }

  // Alvo dentro de uma campanha precisa ter o mesmo segmento + cidade + estado.
  assertTargetMatchesCampaign(campaign: SalesCampaign, target: { businessType: string; city: string; state: string }): void {
    if (campaign.kind !== 'STANDARD' || campaign.status === 'ARCHIVED') {
      throw new BadRequestException('Alvos só podem ficar em campanhas de prospecção não arquivadas.');
    }
    if (campaignIdentityKey(target.businessType, target.city, target.state) !== campaign.identityKey) {
      throw new BadRequestException(
        `O alvo precisa ter o mesmo segmento, cidade e estado da campanha (${campaign.segment} — ${campaign.city}/${campaign.state}).`,
      );
    }
  }

  private findLive(organizationId: string, identityKey: string) {
    return this.prisma.salesCampaign.findFirst({
      where: { organizationId, kind: 'STANDARD', identityKey, status: { in: ['ACTIVE', 'PAUSED'] } },
    });
  }

  private async assertNoLiveCampaign(organizationId: string, identityKey: string, exceptId?: string): Promise<void> {
    const live = await this.findLive(organizationId, identityKey);
    if (live && live.id !== exceptId) {
      throw new ConflictException({
        message: `Já existe a campanha "${live.name}" para esse segmento, cidade e estado.`,
        campaignId: live.id,
      });
    }
  }

  private async freeName(organizationId: string, base: string): Promise<string> {
    const taken = new Set(
      (
        await this.prisma.salesCampaign.findMany({
          where: { organizationId, name: { startsWith: base } },
          select: { name: true },
        })
      ).map((row) => row.name),
    );
    if (!taken.has(base)) return base;
    for (let i = 2; ; i += 1) {
      const candidate = `${base} (${i})`;
      if (!taken.has(candidate)) return candidate;
    }
  }

  private async configTemplate(organizationId: string, state: string | null) {
    const latest = await this.prisma.salesCampaign.findFirst({
      where: { organizationId, kind: 'STANDARD', status: { not: 'ARCHIVED' } },
      orderBy: { createdAt: 'desc' },
    });
    const country = state && BR_STATE_CODES.has(state) ? 'BR' : null;
    if (latest && (!country || latest.country === country)) {
      return Object.fromEntries(HARVEY_CONFIG_FIELDS.map((field) => [field, latest[field]])) as Pick<
        SalesCampaign,
        (typeof HARVEY_CONFIG_FIELDS)[number]
      >;
    }
    const settings = await this.prisma.organizationRevenueSettings.findUnique({
      where: { organizationId },
      select: { defaultOutreachCountry: true },
    });
    const resolved = country ?? settings?.defaultOutreachCountry ?? 'BR';
    return { country: resolved, ...(COUNTRY_DEFAULTS[resolved] ?? { language: 'en-US', timezone: 'UTC' }) };
  }

  private harveyFields(dto: UpdateCampaignDto): UpdateCampaignDto {
    const identityFields = new Set(['name', 'segment', 'city', 'state', 'sources']);
    return Object.fromEntries(Object.entries(dto).filter(([key, value]) => !identityFields.has(key) && value !== undefined));
  }

  // Pausar fecha o ciclo do dia (reaberto ao retomar no mesmo dia);
  // finalizar/arquivar encerra. Histórico de ciclos nunca é apagado.
  private async syncRuns(campaign: SalesCampaign, action: CampaignLifecycleAction, now: Date): Promise<void> {
    if (action === 'resume') {
      await this.prisma.harveyRun.updateMany({
        where: {
          campaignId: campaign.id,
          status: 'STOPPED',
          endReason: 'CAMPAIGN_PAUSED',
          cycleDate: new Date(cycleDateFor(now, campaign.timezone)),
        },
        data: { status: 'RUNNING', endReason: null, endedAt: null },
      });
      return;
    }
    if (action === 'reopen') return;
    await this.prisma.harveyRun.updateMany({
      where: { campaignId: campaign.id, status: { in: ['RUNNING', 'PAUSED'] } },
      data: {
        status: action === 'pause' ? 'STOPPED' : 'COMPLETED',
        endReason: action === 'pause' ? 'CAMPAIGN_PAUSED' : 'CAMPAIGN_CLOSED',
        endedAt: now,
      },
    });
  }

  private async statsFor(campaignIds: string[]): Promise<Map<string, StatsRow>> {
    if (campaignIds.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<StatsRow[]>`
      SELECT c.id AS campaign_id,
        coalesce(l.leads_found, 0) AS leads_found, coalesce(l.qualified, 0) AS qualified,
        coalesce(l.disqualified, 0) AS disqualified, coalesce(l.pending, 0) AS pending,
        coalesce(m.pending_approval, 0) AS pending_approval, coalesce(m.approved, 0) AS approved,
        coalesce(m.sent, 0) AS sent, coalesce(m.replied, 0) AS replied, coalesce(m.rejected, 0) AS rejected,
        (SELECT count(*) FROM prospecting_targets t WHERE t.campaign_id = c.id) AS targets
      FROM sales_campaigns c
      LEFT JOIN LATERAL (
        SELECT count(*) AS leads_found,
          count(*) FILTER (WHERE ld.status NOT IN ('DISCOVERED', 'DISQUALIFIED')) AS qualified,
          count(*) FILTER (WHERE ld.status = 'DISQUALIFIED') AS disqualified,
          count(*) FILTER (WHERE ld.status = 'DISCOVERED') AS pending
        FROM campaign_leads cl JOIN leads ld ON ld.id = cl.lead_id
        WHERE cl.campaign_id = c.id
      ) l ON true
      LEFT JOIN LATERAL (
        SELECT count(*) FILTER (WHERE om.status = 'DRAFT') AS pending_approval,
          count(*) FILTER (WHERE om.approved_at IS NOT NULL) AS approved,
          count(*) FILTER (WHERE om.sent_at IS NOT NULL) AS sent,
          count(*) FILTER (WHERE om.replied_at IS NOT NULL) AS replied,
          count(*) FILTER (WHERE om.status = 'REJECTED') AS rejected
        FROM outreach_messages om WHERE om.campaign_id = c.id
      ) m ON true
      WHERE c.id IN (${Prisma.join(campaignIds)})`;
    return new Map(rows.map((row) => [row.campaign_id, row]));
  }

  private async organizationTotals(organizationId: string) {
    const [row] = await this.prisma.$queryRaw<
      Array<{ campaigns: bigint; active: bigint; leads: bigint; qualified: bigint; sent: bigint; replied: bigint }>
    >`
      SELECT
        (SELECT count(*) FROM sales_campaigns WHERE organization_id = ${organizationId} AND kind = 'STANDARD' AND status <> 'ARCHIVED') AS campaigns,
        (SELECT count(*) FROM sales_campaigns WHERE organization_id = ${organizationId} AND kind = 'STANDARD' AND status = 'ACTIVE') AS active,
        (SELECT count(DISTINCT cl.lead_id) FROM campaign_leads cl WHERE cl.organization_id = ${organizationId}) AS leads,
        (SELECT count(DISTINCT cl.lead_id) FROM campaign_leads cl JOIN leads l ON l.id = cl.lead_id
           WHERE cl.organization_id = ${organizationId} AND l.status NOT IN ('DISCOVERED', 'DISQUALIFIED')) AS qualified,
        (SELECT count(*) FROM outreach_messages WHERE organization_id = ${organizationId} AND sent_at IS NOT NULL) AS sent,
        (SELECT count(*) FROM outreach_messages WHERE organization_id = ${organizationId} AND replied_at IS NOT NULL) AS replied`;
    return {
      campaigns: Number(row?.campaigns ?? 0),
      activeCampaigns: Number(row?.active ?? 0),
      leads: Number(row?.leads ?? 0),
      qualified: Number(row?.qualified ?? 0),
      messagesSent: Number(row?.sent ?? 0),
      messagesReplied: Number(row?.replied ?? 0),
    };
  }

  private withStats(campaign: SalesCampaign, stats: Map<string, StatsRow>): CampaignWithStats {
    const row = stats.get(campaign.id);
    return {
      ...campaign,
      targetCount: Number(row?.targets ?? 0),
      stats: row
        ? {
            leadsFound: Number(row.leads_found),
            qualified: Number(row.qualified),
            disqualified: Number(row.disqualified),
            pending: Number(row.pending),
            messagesPendingApproval: Number(row.pending_approval),
            messagesApproved: Number(row.approved),
            messagesSent: Number(row.sent),
            messagesReplied: Number(row.replied),
            messagesRejected: Number(row.rejected),
          }
        : EMPTY_STATS,
    };
  }

  private validate<T extends UpdateCampaignDto>(dto: T, current: SalesCampaign | null): T {
    if (dto.timezone !== undefined && !isValidTimezone(dto.timezone)) {
      throw new BadRequestException(`Fuso horário inválido: ${dto.timezone}`);
    }
    const start = dto.workStartMinute ?? current?.workStartMinute ?? 540;
    const end = dto.workEndMinute ?? current?.workEndMinute ?? 1080;
    if (end <= start) {
      throw new BadRequestException('O fim do horário de trabalho precisa ser depois do início.');
    }
    const notConnected = (dto.enabledChannels ?? []).filter(
      (channel) => !(CONNECTED_CHANNELS as readonly string[]).includes(channel),
    );
    if (notConnected.length > 0) {
      throw new BadRequestException(
        `Canal ainda não conectado: ${notConnected.join(', ')}. Só e-mail tem envio integrado nesta fase.`,
      );
    }
    return dto;
  }

  private audit(organizationId: string, userId: string, action: string, campaignId: string, changes: object) {
    return this.auditService.log({
      actorType: 'USER',
      actorId: userId,
      organizationId,
      action,
      resource: `SalesCampaign:${campaignId}`,
      metadata: { changes } as Prisma.InputJsonValue,
    });
  }

  private mapUnique(error: unknown): unknown {
    if (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002') {
      return new ConflictException('Já existe uma campanha com esse nome ou com esse segmento, cidade e estado.');
    }
    return error;
  }
}

const ACTION_LABELS: Record<CampaignLifecycleAction, string> = {
  pause: 'pausar',
  resume: 'retomar',
  complete: 'finalizar',
  reopen: 'reabrir',
  archive: 'arquivar',
};

