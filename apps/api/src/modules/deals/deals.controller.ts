import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import type { Deal } from '@opsmind/database';
import { DealsService } from './deals.service';
import { CreateDealDto } from './dto/create-deal.dto';
import { UpdateDealDto } from './dto/update-deal.dto';
import { MoveDealStageDto } from './dto/move-deal-stage.dto';
import { ListDealsQueryDto } from './dto/list-deals-query.dto';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { RolesGuard } from '../../shared/guards/roles.guard';
import { Roles } from '../../shared/decorators/roles.decorator';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { WRITE_ROLES } from '../../shared/constants/roles.constant';

@UseGuards(TenantGuard)
@Controller('organizations/:organizationId/deals')
export class DealsController {
  constructor(private readonly dealsService: DealsService) {}

  @Roles(...WRITE_ROLES)
  @UseGuards(RolesGuard)
  @Post()
  create(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: CreateDealDto,
  ): Promise<Deal> {
    return this.dealsService.create(organizationId, dto, user.id);
  }

  @Get()
  list(
    @Param('organizationId') organizationId: string,
    @Query() query: ListDealsQueryDto,
  ): Promise<Deal[]> {
    return this.dealsService.list(organizationId, query);
  }

  @Get(':dealId')
  findOne(
    @Param('organizationId') organizationId: string,
    @Param('dealId') dealId: string,
  ): Promise<Deal> {
    return this.dealsService.findByIdOrThrow(organizationId, dealId);
  }

  @Roles(...WRITE_ROLES)
  @UseGuards(RolesGuard)
  @Patch(':dealId')
  update(
    @Param('organizationId') organizationId: string,
    @Param('dealId') dealId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: UpdateDealDto,
  ): Promise<Deal> {
    return this.dealsService.update(organizationId, dealId, dto, user.id);
  }

  @Roles(...WRITE_ROLES)
  @UseGuards(RolesGuard)
  @Post(':dealId/move-stage')
  moveStage(
    @Param('organizationId') organizationId: string,
    @Param('dealId') dealId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: MoveDealStageDto,
  ): Promise<Deal> {
    return this.dealsService.moveStage(organizationId, dealId, dto, user.id);
  }

  @Roles(...WRITE_ROLES)
  @UseGuards(RolesGuard)
  @HttpCode(204)
  @Delete(':dealId')
  async remove(
    @Param('organizationId') organizationId: string,
    @Param('dealId') dealId: string,
    @CurrentUser() user: { id: string },
  ): Promise<void> {
    await this.dealsService.remove(organizationId, dealId, user.id);
  }
}
