import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { ProspectingTarget } from '@opsmind/database';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ScrapeJobsService } from './scrape-jobs.service';
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
  ) {}

  async create(
    organizationId: string,
    dto: CreateProspectingTargetDto,
    actorUserId: string,
  ): Promise<ProspectingTarget> {
    try {
      const target = await this.prisma.prospectingTarget.create({
        data: {
          organizationId,
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

  // Best-effort: um `ScrapeJob` disparado por aqui é um acelerador, não a
  // única forma do alvo ser escaneado — o sweep diário do worker continua
  // como rede de segurança. Por isso uma falha aqui (fila/Redis indisponível)
  // nunca deve derrubar `create()`/`update()`, só fica registrada no log.
  private async triggerScan(
    organizationId: string,
    target: ProspectingTarget,
    actorUserId: string,
  ): Promise<void> {
    try {
      await this.scrapeJobsService.create(
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
      );
    } catch (error) {
      this.logger.warn(
        `Falha ao disparar scan imediato pro alvo ${target.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
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
