import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { ServiceOffering } from '@opsmind/database';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateServiceOfferingDto } from './dto/create-service-offering.dto';
import { UpdateServiceOfferingDto } from './dto/update-service-offering.dto';

export interface ListServiceOfferingsFilter {
  isActive?: boolean;
}

/**
 * Adaptado quase verbatim de
 * `../feat-prospecting-outbound/apps/api/src/modules/prospecting/service-offerings.service.ts`
 * — mesmo padrão sem repository layer, `PrismaService` direto. Único
 * acréscimo real são os campos de ICP estruturado
 * (`targetIndustries`/min-max Employees/RevenueUsd) e o audit log em toda
 * mutação (convenção desta branch, ausente no branch de referência).
 */
@Injectable()
export class ServiceOfferingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(
    organizationId: string,
    dto: CreateServiceOfferingDto,
    actorUserId: string,
  ): Promise<ServiceOffering> {
    try {
      const offering = await this.prisma.serviceOffering.create({
        data: { organizationId, ...dto },
      });

      await this.auditService.log({
        actorType: 'USER',
        actorId: actorUserId,
        organizationId,
        action: 'service_offering.created',
        resource: `ServiceOffering:${offering.id}`,
      });

      return offering;
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException('Já existe uma oferta com esse nome nesta organização');
      }
      throw error;
    }
  }

  async findByIdOrThrow(organizationId: string, id: string): Promise<ServiceOffering> {
    const offering = await this.prisma.serviceOffering.findFirst({
      where: { id, organizationId },
    });
    if (!offering) {
      throw new NotFoundException('Oferta de serviço não encontrada');
    }
    return offering;
  }

  list(
    organizationId: string,
    filter: ListServiceOfferingsFilter = {},
  ): Promise<ServiceOffering[]> {
    return this.prisma.serviceOffering.findMany({
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
    dto: UpdateServiceOfferingDto,
    actorUserId: string,
  ): Promise<ServiceOffering> {
    await this.findByIdOrThrow(organizationId, id);

    try {
      const updated = await this.prisma.serviceOffering.update({ where: { id }, data: dto });

      await this.auditService.log({
        actorType: 'USER',
        actorId: actorUserId,
        organizationId,
        action: 'service_offering.updated',
        resource: `ServiceOffering:${id}`,
        metadata: { ...dto },
      });

      return updated;
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException('Já existe uma oferta com esse nome nesta organização');
      }
      throw error;
    }
  }

  async remove(organizationId: string, id: string, actorUserId: string): Promise<void> {
    await this.findByIdOrThrow(organizationId, id);
    await this.prisma.serviceOffering.delete({ where: { id } });

    await this.auditService.log({
      actorType: 'USER',
      actorId: actorUserId,
      organizationId,
      action: 'service_offering.deleted',
      resource: `ServiceOffering:${id}`,
    });
  }

  // Duck-typing em vez de `instanceof Prisma.PrismaClientKnownRequestError`
  // — mesma abordagem de `OrganizationsService.isUniqueConstraintError`.
  private isUniqueConstraintError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code: unknown }).code === 'P2002'
    );
  }
}
