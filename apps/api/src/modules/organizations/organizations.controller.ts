import { Body, Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
import type { Organization } from '@opsmind/database';
import { OrganizationsService } from './organizations.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';

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
}
