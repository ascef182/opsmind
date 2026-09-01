import { ConflictException, Injectable } from '@nestjs/common';
import type { Organization } from '@opsmind/database';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove acentos (após NFD, diacríticos viram combining marks)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Sem repository layer (Decisão #12 do blueprint) — chama `PrismaService`
 * diretamente.
 */
@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(userId: string, dto: CreateOrganizationDto): Promise<Organization> {
    const slug = dto.slug ?? slugify(dto.name);

    try {
      const organization = await this.prisma.runInTransaction(async (tx) => {
        const org = await tx.organization.create({ data: { name: dto.name, slug } });
        await tx.membership.create({
          data: { userId, organizationId: org.id, role: 'OWNER' },
        });
        return org;
      });

      await this.auditService.log({
        actorType: 'USER',
        actorId: userId,
        organizationId: organization.id,
        action: 'organization.created',
        resource: `Organization:${organization.id}`,
      });

      return organization;
    } catch (error) {
      // Duck-typing em vez de `instanceof Prisma.PrismaClientKnownRequestError`:
      // qualquer erro com esse formato (real ou de teste) é tratado igual —
      // não há necessidade de acoplar a checagem à classe concreta do Prisma.
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException('Slug já está em uso por outra organização');
      }
      throw error;
    }
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code: unknown }).code === 'P2002'
    );
  }

  findById(id: string): Promise<Organization | null> {
    return this.prisma.organization.findUnique({ where: { id } });
  }

  /**
   * Lookup usado pela rota pública GET /organizations/:id: filtra por
   * membership na própria query em vez de checar depois — um usuário sem
   * vínculo recebe o mesmo resultado (null → 404) de uma org inexistente,
   * sem confirmar a existência da org para quem não é membro dela.
   * Substituído pelo TenantGuard de verdade no Passo 8.
   */
  findByIdForUser(id: string, userId: string): Promise<Organization | null> {
    return this.prisma.organization.findFirst({
      where: { id, memberships: { some: { userId } } },
    });
  }

  listForUser(userId: string): Promise<Organization[]> {
    return this.prisma.organization.findMany({
      where: { memberships: { some: { userId } } },
    });
  }

  /**
   * Fecha a lacuna do PRD §17 (Fase 7): `aiMonthlyBudget` já existia no schema
   * e já era lido por `BudgetService`/`AiService` desde a Fase 3, mas não
   * havia como configurá-lo — só editando o banco direto.
   */
  async updateBudget(
    organizationId: string,
    actorUserId: string,
    aiMonthlyBudget: number | null | undefined,
  ): Promise<Organization> {
    const organization = await this.prisma.organization.update({
      where: { id: organizationId },
      data: { aiMonthlyBudget },
    });

    await this.auditService.log({
      actorType: 'USER',
      actorId: actorUserId,
      organizationId,
      action: 'organization.ai_budget_updated',
      resource: `Organization:${organizationId}`,
      metadata: { aiMonthlyBudget: aiMonthlyBudget ?? null },
    });

    return organization;
  }
}
