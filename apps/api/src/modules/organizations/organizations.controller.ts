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

  // Sem TenantGuard ainda (chega no Passo 8) — o escopo por membership é
  // aplicado aqui na própria query (findByIdForUser), não por um guard.
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
