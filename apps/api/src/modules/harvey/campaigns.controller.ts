import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import type { SalesCampaign } from '@opsmind/database';
import type { CampaignLifecycleAction } from '@opsmind/shared-types';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { RolesGuard } from '../../shared/guards/roles.guard';
import { Roles } from '../../shared/decorators/roles.decorator';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { CampaignsService, type CampaignWithStats } from './campaigns.service';
import {
  CAMPAIGN_LIFECYCLE_ACTIONS,
  CampaignOverviewQueryDto,
  CreateCampaignDto,
  UpdateCampaignDto,
} from './dto/campaign.dto';

export type CampaignResponse = Omit<SalesCampaign, 'monthlyBudgetUsd'> & { monthlyBudgetUsd: number | null };

function toResponse<T extends SalesCampaign>(campaign: T): Omit<T, 'monthlyBudgetUsd'> & { monthlyBudgetUsd: number | null } {
  return { ...campaign, monthlyBudgetUsd: campaign.monthlyBudgetUsd === null ? null : Number(campaign.monthlyBudgetUsd) };
}

@UseGuards(TenantGuard)
@Controller('organizations/:organizationId/revenue/campaigns')
export class CampaignsController {
  constructor(private readonly campaignsService: CampaignsService) {}

  @Get()
  async list(
    @Param('organizationId') organizationId: string,
    @Query('includeArchived') includeArchived?: string,
  ): Promise<CampaignResponse[]> {
    return (await this.campaignsService.list(organizationId, includeArchived === 'true')).map(toResponse);
  }

  @Get('overview')
  async overview(@Param('organizationId') organizationId: string, @Query() query: CampaignOverviewQueryDto) {
    const result = await this.campaignsService.overview(organizationId, query);
    return { ...result, items: result.items.map(toResponse) };
  }

  @Get(':campaignId')
  async detail(
    @Param('organizationId') organizationId: string,
    @Param('campaignId') campaignId: string,
  ): Promise<Omit<CampaignWithStats, 'monthlyBudgetUsd'> & { monthlyBudgetUsd: number | null }> {
    return toResponse(await this.campaignsService.detail(organizationId, campaignId));
  }

  @Roles('OWNER', 'ADMIN')
  @UseGuards(RolesGuard)
  @Post()
  async create(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: CreateCampaignDto,
  ): Promise<CampaignResponse> {
    return toResponse(await this.campaignsService.create(organizationId, dto, user.id));
  }

  @Roles('OWNER', 'ADMIN')
  @UseGuards(RolesGuard)
  @Patch(':campaignId')
  async update(
    @Param('organizationId') organizationId: string,
    @Param('campaignId') campaignId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: UpdateCampaignDto,
  ): Promise<CampaignResponse> {
    return toResponse(await this.campaignsService.update(organizationId, campaignId, dto, user.id));
  }

  @Roles('OWNER', 'ADMIN')
  @UseGuards(RolesGuard)
  @Post(':campaignId/:action')
  async changeStatus(
    @Param('organizationId') organizationId: string,
    @Param('campaignId') campaignId: string,
    @Param('action') action: string,
    @CurrentUser() user: { id: string },
  ): Promise<CampaignResponse> {
    if (!(CAMPAIGN_LIFECYCLE_ACTIONS as readonly string[]).includes(action)) {
      throw new BadRequestException(`Ação desconhecida: ${action}`);
    }
    return toResponse(
      await this.campaignsService.changeStatus(organizationId, campaignId, action as CampaignLifecycleAction, user.id),
    );
  }
}
