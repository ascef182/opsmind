import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { ServiceOffering } from '@opsmind/database';
import { ServiceOfferingsService } from './service-offerings.service';
import { CreateServiceOfferingDto } from './dto/create-service-offering.dto';
import { UpdateServiceOfferingDto } from './dto/update-service-offering.dto';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { RolesGuard } from '../../shared/guards/roles.guard';
import { Roles } from '../../shared/decorators/roles.decorator';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { WRITE_ROLES } from '../../shared/constants/roles.constant';

@UseGuards(TenantGuard)
@Controller('organizations/:organizationId/service-offerings')
export class ServiceOfferingsController {
  constructor(private readonly serviceOfferingsService: ServiceOfferingsService) {}

  @Roles(...WRITE_ROLES)
  @UseGuards(RolesGuard)
  @Post()
  create(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: CreateServiceOfferingDto,
  ): Promise<ServiceOffering> {
    return this.serviceOfferingsService.create(organizationId, dto, user.id);
  }

  @Get()
  list(
    @Param('organizationId') organizationId: string,
    @Query('isActive') isActive?: string,
  ): Promise<ServiceOffering[]> {
    return this.serviceOfferingsService.list(organizationId, {
      isActive: isActive === undefined ? undefined : isActive === 'true',
    });
  }

  @Get(':offeringId')
  findOne(
    @Param('organizationId') organizationId: string,
    @Param('offeringId') offeringId: string,
  ): Promise<ServiceOffering> {
    return this.serviceOfferingsService.findByIdOrThrow(organizationId, offeringId);
  }

  @Roles(...WRITE_ROLES)
  @UseGuards(RolesGuard)
  @Patch(':offeringId')
  update(
    @Param('organizationId') organizationId: string,
    @Param('offeringId') offeringId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: UpdateServiceOfferingDto,
  ): Promise<ServiceOffering> {
    return this.serviceOfferingsService.update(organizationId, offeringId, dto, user.id);
  }

  @Roles(...WRITE_ROLES)
  @UseGuards(RolesGuard)
  @HttpCode(204)
  @Delete(':offeringId')
  async remove(
    @Param('organizationId') organizationId: string,
    @Param('offeringId') offeringId: string,
    @CurrentUser() user: { id: string },
  ): Promise<void> {
    await this.serviceOfferingsService.remove(organizationId, offeringId, user.id);
  }
}
