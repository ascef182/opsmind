import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { ProspectingTarget, ScrapeJob } from '@opsmind/database';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ScrapeJobsService } from './scrape-jobs.service';
import { CampaignsService } from '../harvey/campaigns.service';
import { CreateProspectingTargetDto } from './dto/create-prospecting-target.dto';
import { UpdateProspectingTargetDto } from './dto/update-prospecting-target.dto';

export interface ListProspectingTargetsFilter {
  isActive?: boolean;
}

/**
 * CRUD de config recorrente, mesmo espírito de
 * `ServiceOfferingsService`/`ScrapeJobsService` — sem repository layer,
 * `PrismaService` direto. O sweep diário do worker
 * (`apps/worker/src/prospecting-scan.ts`) continua sendo quem varre TODOS os
 * alvos ativos por cooldown — mas criar/reativar um alvo aqui também dispara
 * um `ScrapeJob` imediato (`triggerScan` abaixo), pra não deixar o usuário
 * esperando até 24h pelo próximo sweep só pra ver o primeiro resultado.
 *
 * `@@unique([organizationId, city, state, businessType, sourceType])` no
 * schema (Task 2) — mesmo tratamento de conflito de nome duplicado que
 * `ServiceOfferingsService` já faz para `ServiceOffering`.
 */
@Injectable()
export class ProspectingTargetsService {
  private readonly logger = new Logger(ProspectingTargetsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly scrapeJobsService: ScrapeJobsService,
    private readonly campaignsService: CampaignsService,
  ) {}

  async create(
    organizationId: string,
    dto: CreateProspectingTargetDto,
    actorUserId: string,
  ): Promise<ProspectingTarget> {
    // Alvo é uma busca recorrente dentro da campanha do seu segmento + cidade + estado.
    const campaign = dto.campaignId
      ? await this.campaignsService.findByIdOrThrow(organizationId, dto.campaignId)
      : await this.campaignsService.findOrCreateForSearch(organizationId, dto);
    this.campaignsService.assertTargetMatchesCampaign(campaign, dto);
    try {
      const target = await this.prisma.prospectingTarget.create({
        data: {
          organizationId,
          campaignId: campaign.id,
          city: dto.city,
          state: dto.state,
          businessType: dto.businessType,
          sourceType: dto.sourceType ?? 'APIFY_GOOGLE_MAPS',
          onlyWithoutWebsite: dto.onlyWithoutWebsite ?? true,
          ...(dto.limit !== undefined ? { limit: dto.limit } : {}),
          isActive: dto.isActive ?? true,
          cooldownDays: dto.cooldownDays ?? 7,
        },
      });

      await this.auditService.log({
        actorType: 'USER',
        actorId: actorUserId,
        organizationId,
        action: 'prospecting_target.created',
        resource: `ProspectingTarget:${target.id}`,
        metadata: {
          city: dto.city,
          state: dto.state,
          businessType: dto.businessType,
          sourceType: target.sourceType,
        },
      });

      if (target.isActive) {
        await this.triggerScan(organizationId, target, actorUserId);
      }

      return target;
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException(
          'Já existe um alvo de prospecção com essa combinação de cidade/estado/tipo de negócio/fonte nesta organização',
        );
      }
      throw error;
    }
  }

  async findByIdOrThrow(organizationId: string, id: string): Promise<ProspectingTarget> {
    const target = await this.prisma.prospectingTarget.findFirst({
      where: { id, organizationId },
    });
    if (!target) {
      throw new NotFoundException('Alvo de prospecção não encontrado');
    }
    return target;
  }

  list(
    organizationId: string,
    filter: ListProspectingTargetsFilter = {},
  ): Promise<ProspectingTarget[]> {
    return this.prisma.prospectingTarget.findMany({
      where: {
        organizationId,
        ...(filter.isActive !== undefined ? { isActive: filter.isActive } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async update(
    organizationId: string,
    id: string,
    dto: UpdateProspectingTargetDto,
    actorUserId: string,
  ): Promise<ProspectingTarget> {
    const existing = await this.findByIdOrThrow(organizationId, id);
    // A campanha precisa ser da mesma organização (a FK aceitaria qualquer id)
    // e ter o mesmo segmento + cidade + estado do alvo depois da edição.
    // Sem campanha explícita, mudar segmento/cidade/estado leva o alvo para a
    // campanha da nova combinação.
    const identity = {
      businessType: dto.businessType ?? existing.businessType,
      city: dto.city ?? existing.city,
      state: dto.state ?? existing.state,
    };
    const current = await this.campaignsService.findByIdOrThrow(organizationId, dto.campaignId ?? existing.campaignId);
    const identityChanged =
      !dto.campaignId &&
      (identity.businessType !== existing.businessType || identity.city !== existing.city || identity.state !== existing.state);
    const campaign = identityChanged ? await this.campaignsService.findOrCreateForSearch(organizationId, identity) : current;
    this.campaignsService.assertTargetMatchesCampaign(campaign, identity);
    if (identityChanged && campaign.id !== existing.campaignId) dto = { ...dto, campaignId: campaign.id };

    try {
      const updated = await this.prisma.prospectingTarget.update({ where: { id }, data: dto });

      await this.auditService.log({
        actorType: 'USER',
        actorId: actorUserId,
        organizationId,
        action: 'prospecting_target.updated',
        resource: `ProspectingTarget:${id}`,
        metadata: { ...dto },
      });

      // Reativação (false -> true) = "quero buscar de novo agora" — mesmo
      // gatilho de `create()`. Sem trigger quando já estava ativo (evita
      // duplicar scan a cada edição de campo não relacionado) ou quando está
      // sendo desativado.
      if (!existing.isActive && updated.isActive) {
        await this.triggerScan(organizationId, updated, actorUserId);
      }

      return updated;
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException(
          'Já existe um alvo de prospecção com essa combinação de cidade/estado/tipo de negócio/fonte nesta organização',
        );
      }
      throw error;
    }
  }

  async remove(organizationId: string, id: string, actorUserId: string): Promise<void> {
    await this.findByIdOrThrow(organizationId, id);
    await this.prisma.prospectingTarget.delete({ where: { id } });

    await this.auditService.log({
      actorType: 'USER',
      actorId: actorUserId,
      organizationId,
      action: 'prospecting_target.removed',
      resource: `ProspectingTarget:${id}`,
    });
  }

  /**
   * Dispara um scan manual "agora" pro alvo, ignorando `cooldownDays` (ação
   * explícita do usuário = mesma confiança que "+ Nova busca" em `/leads`
   * já tem) — service nunca checou cooldown, só o sweep agendado do worker
   * checa, então não há nada a "ignorar" de propósito aqui além de não
   * reimplementar aquela checagem.
   */
  async runNow(organizationId: string, id: string, actorUserId: string): Promise<ScrapeJob | null> {
    const target = await this.findByIdOrThrow(organizationId, id);
    return this.triggerScan(organizationId, target, actorUserId);
  }

  // Best-effort: um `ScrapeJob` disparado por aqui é um acelerador, não a
  // única forma do alvo ser escaneado — o sweep diário do worker continua
  // como rede de segurança. Por isso uma falha aqui (fila/Redis indisponível)
  // nunca deve derrubar `create()`/`update()`/`runNow()`, só fica registrada
  // no log e retorna `null`.
  private async triggerScan(
    organizationId: string,
    target: ProspectingTarget,
    actorUserId: string,
  ): Promise<ScrapeJob | null> {
    try {
      return await this.scrapeJobsService.create(
        organizationId,
        {
          sourceType: target.sourceType,
          city: target.city,
          state: target.state,
          businessType: target.businessType,
          onlyWithoutWebsite: target.onlyWithoutWebsite,
          ...(target.limit !== null ? { limit: target.limit } : {}),
        },
        actorUserId,
        { campaignId: target.campaignId, prospectingTargetId: target.id },
      );
    } catch (error) {
      this.logger.warn(
        `Falha ao disparar scan imediato pro alvo ${target.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  // Duck-typing em vez de `instanceof Prisma.PrismaClientKnownRequestError`
  // — mesma abordagem de `ServiceOfferingsService.isUniqueConstraintError`.
  private isUniqueConstraintError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code: unknown }).code === 'P2002'
    );
  }
}
