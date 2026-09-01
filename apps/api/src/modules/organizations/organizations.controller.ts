import { Body, Controller, Get, NotFoundException, Param, Patch, Post, UseGuards } from '@nestjs/common';
import type { Organization } from '@opsmind/database';
import { OrganizationsService } from './organizations.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { RolesGuard } from '../../shared/guards/roles.guard';
import { Roles } from '../../shared/decorators/roles.decorator';

// `Organization.aiMonthlyBudget` é um Prisma `Decimal` — JSON.stringify chama
// Decimal.toJSON(), que devolve STRING (ex.: "150"), não number. Não há
// serializer interceptor global nesta app, então cada rota HTTP que devolve
// uma Organization precisa converter explicitamente antes da resposta sair,
// pra bater com `OrganizationDto.aiMonthlyBudget: number | null`
// (packages/shared-types). Consumidores internos (ex.: AiService, que lê
// organization.aiMonthlyBudget como Decimal cru via Number(...)) continuam
// recebendo a Organization do Prisma sem passar por este mapper — só a
// fronteira HTTP desta controller converte.
export type OrganizationResponse = Omit<Organization, 'aiMonthlyBudget'> & { aiMonthlyBudget: number | null };

function toOrganizationResponse(org: Organization): OrganizationResponse {
  return {
    ...org,
    aiMonthlyBudget: org.aiMonthlyBudget ? Number(org.aiMonthlyBudget) : null,
  };
}

@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Post()
  async create(
    @CurrentUser() user: { id: string },
    @Body() dto: CreateOrganizationDto,
  ): Promise<OrganizationResponse> {
    const organization = await this.organizationsService.create(user.id, dto);
    return toOrganizationResponse(organization);
  }

  // Front-end precisa disso para o onboarding (login → "de quais orgs você
  // já é membro?" → dashboard ou tela de criar organização) — existia como
  // OrganizationsService.listForUser desde a Fase 1, mas nunca tinha rota.
  @Get()
  async list(@CurrentUser() user: { id: string }): Promise<OrganizationResponse[]> {
    const organizations = await this.organizationsService.listForUser(user.id);
    return organizations.map(toOrganizationResponse);
  }

  // Não usa TenantGuard (Passo 8): o guard é para recursos aninhados sob uma
  // organização (`/organizations/:organizationId/...`), não para a própria
  // organização como recurso. O escopo por membership é feito na query
  // (findByIdForUser) — mesmo efeito, sem organização "pai" para checar.
  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
  ): Promise<OrganizationResponse> {
    const organization = await this.organizationsService.findByIdForUser(id, user.id);
    if (!organization) {
      throw new NotFoundException();
    }
    return toOrganizationResponse(organization);
  }

  // Único endpoint desta controller que precisa de TenantGuard/RolesGuard —
  // por isso o param se chama `:organizationId` aqui (o que TenantGuard
  // exige) e não `:id` como as rotas acima, que não checam papel.
  @Roles('OWNER', 'ADMIN')
  @UseGuards(TenantGuard, RolesGuard)
  @Patch(':organizationId')
  async update(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: UpdateOrganizationDto,
  ): Promise<OrganizationResponse> {
    const organization = await this.organizationsService.updateBudget(organizationId, user.id, dto.aiMonthlyBudget);
    return toOrganizationResponse(organization);
  }
}
