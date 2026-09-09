import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { ProspectingTarget } from '@opsmind/database';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateProspectingTargetDto } from './dto/create-prospecting-target.dto';
import { UpdateProspectingTargetDto } from './dto/update-prospecting-target.dto';

export interface ListProspectingTargetsFilter {
  isActive?: boolean;
}

/**
 * CRUD simples de config recorrente, mesmo espírito de
 * `ServiceOfferingsService`/`ScrapeJobsService` — sem repository layer,
 * `PrismaService` direto. Diferente de `ScrapeJobsService`, não enfileira
 * nada aqui: quem lê `ProspectingTarget.isActive`/`cooldownDays` e dispara
 * `ScrapeJob`s é o scan do worker (Task 7), fora do escopo desta task.
 *
 * `@@unique([organizationId, city, state, businessType, sourceType])` no
 * schema (Task 2) — mesmo tratamento de conflito de nome duplicado que
 * `ServiceOfferingsService` já faz para `ServiceOffering`.
 */
@Injectable()
export class ProspectingTargetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
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
    await this.findByIdOrThrow(organizationId, id);

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
