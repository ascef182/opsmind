import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, SalesCampaign } from '@opsmind/database';
import { isValidTimezone } from '@opsmind/shared-types';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { CreateCampaignDto, UpdateCampaignDto } from './dto/campaign.dto';

// Canais com envio real integrado. Os demais não podem ser habilitados numa
// campanha até a integração existir (Fase 3).
export const CONNECTED_CHANNELS = ['EMAIL'] as const;

const COUNTRY_DEFAULTS: Record<string, { language: string; timezone: string }> = {
  US: { language: 'en-US', timezone: 'America/New_York' },
  BR: { language: 'pt-BR', timezone: 'America/Sao_Paulo' },
};

export function defaultCampaignData(organizationId: string, country = 'US') {
  const defaults = COUNTRY_DEFAULTS[country] ?? { language: 'en-US', timezone: 'UTC' };
  return { organizationId, name: 'Campanha padrão', country, ...defaults };
}

@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  list(organizationId: string): Promise<SalesCampaign[]> {
    return this.prisma.salesCampaign.findMany({
      where: { organizationId },
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async findByIdOrThrow(organizationId: string, id: string): Promise<SalesCampaign> {
    const campaign = await this.prisma.salesCampaign.findFirst({ where: { id, organizationId } });
    if (!campaign) throw new NotFoundException('Campanha não encontrada');
    return campaign;
  }

  // Campanha usada quando nada foi escolhido: a ativa mais antiga. Cria a
  // padrão se a organização ainda não tiver nenhuma.
  async getDefault(organizationId: string): Promise<SalesCampaign> {
    const existing = await this.prisma.salesCampaign.findFirst({
      where: { organizationId, status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
    });
    if (existing) return existing;
    // Sem campanha ativa: reativa a padrão arquivada em vez de colidir no nome.
    const archivedDefault = await this.prisma.salesCampaign.findFirst({
      where: { organizationId, name: 'Campanha padrão' },
    });
    if (archivedDefault) {
      return this.prisma.salesCampaign.update({ where: { id: archivedDefault.id }, data: { status: 'ACTIVE' } });
    }
    const settings = await this.prisma.organizationRevenueSettings.findUnique({
      where: { organizationId },
      select: { defaultOutreachCountry: true },
    });
    return this.prisma.salesCampaign.create({
      data: defaultCampaignData(organizationId, settings?.defaultOutreachCountry ?? 'US'),
    });
  }

  async create(organizationId: string, dto: CreateCampaignDto, userId: string): Promise<SalesCampaign> {
    const data = this.validate(dto, null);
    try {
      const campaign = await this.prisma.salesCampaign.create({
        data: { ...data, organizationId, name: dto.name, country: dto.country, language: dto.language, timezone: dto.timezone },
      });
      await this.audit(organizationId, userId, 'harvey.campaign.created', campaign.id, dto);
      return campaign;
    } catch (error) {
      throw this.mapUnique(error);
    }
  }

  async update(organizationId: string, id: string, dto: UpdateCampaignDto, userId: string): Promise<SalesCampaign> {
    const current = await this.findByIdOrThrow(organizationId, id);
    const data = this.validate(dto, current);
    try {
      const updated = await this.prisma.salesCampaign.update({ where: { id: current.id }, data });
      await this.audit(organizationId, userId, 'harvey.campaign.updated', id, dto);
      return updated;
    } catch (error) {
      throw this.mapUnique(error);
    }
  }

  private validate(dto: UpdateCampaignDto, current: SalesCampaign | null): UpdateCampaignDto {
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

  private audit(organizationId: string, userId: string, action: string, campaignId: string, dto: object) {
    return this.auditService.log({
      actorType: 'USER',
      actorId: userId,
      organizationId,
      action,
      resource: `SalesCampaign:${campaignId}`,
      metadata: { changes: { ...dto } } as Prisma.InputJsonValue,
    });
  }

  private mapUnique(error: unknown): unknown {
    if (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002') {
      return new ConflictException('Já existe uma campanha com esse nome nesta organização.');
    }
    return error;
  }
}
