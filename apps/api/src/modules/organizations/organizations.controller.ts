import { Body, Controller, Get, NotFoundException, Param, Patch, Post, UseGuards } from '@nestjs/common';
import type { Organization } from '@opsmind/database';
import { OrganizationsService } from './organizations.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { RolesGuard } from '../../shared/guards/roles.guard';
import { Roles } from '../../shared/decorators/roles.decorator';

@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Post()
  create(
    @CurrentUser() user: { id: string },
    @Body() dto: CreateOrganizationDto,
  ): Promise<Organization> {
    return this.organizationsService.create(user.id, dto);
  }

  // Front-end precisa disso para o onboarding (login → "de quais orgs você
  // já é membro?" → dashboard ou tela de criar organização) — existia como
  // OrganizationsService.listForUser desde a Fase 1, mas nunca tinha rota.
  @Get()
  list(@CurrentUser() user: { id: string }): Promise<Organization[]> {
    return this.organizationsService.listForUser(user.id);
  }

  // Não usa TenantGuard (Passo 8): o guard é para recursos aninhados sob uma
  // organização (`/organizations/:organizationId/...`), não para a própria
  // organização como recurso. O escopo por membership é feito na query
  // (findByIdForUser) — mesmo efeito, sem organização "pai" para checar.
  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
  ): Promise<Organization> {
    const organization = await this.organizationsService.findByIdForUser(id, user.id);
    if (!organization) {
      throw new NotFoundException();
    }
    return organization;
  }

  // Único endpoint desta controller que precisa de TenantGuard/RolesGuard —
  // por isso o param se chama `:organizationId` aqui (o que TenantGuard
  // exige) e não `:id` como as rotas acima, que não checam papel.
  @Roles('OWNER', 'ADMIN')
  @UseGuards(TenantGuard, RolesGuard)
  @Patch(':organizationId')
  update(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: UpdateOrganizationDto,
  ): Promise<Organization> {
    return this.organizationsService.updateBudget(organizationId, user.id, dto.aiMonthlyBudget);
  }
}
