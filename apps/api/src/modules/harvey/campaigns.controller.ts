import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import type { SalesCampaign } from '@opsmind/database';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { RolesGuard } from '../../shared/guards/roles.guard';
import { Roles } from '../../shared/decorators/roles.decorator';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { CampaignsService } from './campaigns.service';
import { CreateCampaignDto, UpdateCampaignDto } from './dto/campaign.dto';

export type CampaignResponse = Omit<SalesCampaign, 'monthlyBudgetUsd'> & { monthlyBudgetUsd: number | null };

function toResponse(campaign: SalesCampaign): CampaignResponse {
  return { ...campaign, monthlyBudgetUsd: campaign.monthlyBudgetUsd === null ? null : Number(campaign.monthlyBudgetUsd) };
}

@UseGuards(TenantGuard)
@Controller('organizations/:organizationId/revenue/campaigns')
export class CampaignsController {
  constructor(private readonly campaignsService: CampaignsService) {}

  @Get()
  async list(@Param('organizationId') organizationId: string): Promise<CampaignResponse[]> {
    return (await this.campaignsService.list(organizationId)).map(toResponse);
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
}
