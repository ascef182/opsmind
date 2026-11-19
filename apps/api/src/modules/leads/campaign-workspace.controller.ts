import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { IsString } from 'class-validator';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { RolesGuard } from '../../shared/guards/roles.guard';
import { Roles } from '../../shared/decorators/roles.decorator';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { WRITE_ROLES } from '../../shared/constants/roles.constant';
import type { LeadDuplicateCandidate } from '@opsmind/database';
import {
  CampaignWorkspaceService,
  type CampaignLeadRow,
  type CampaignMessageRow,
  type LeadParticipation,
  type Paginated,
} from './campaign-workspace.service';
import { LeadDuplicatesService, type DuplicateCandidateView } from './lead-duplicates.service';
import {
  CampaignLeadsQueryDto,
  CampaignMessagesQueryDto,
  DuplicateCandidatesQueryDto,
} from './dto/campaign-leads-query.dto';

class ConfirmDuplicateDto {
  @IsString()
  duplicateLeadId!: string;
}

@UseGuards(TenantGuard)
@Controller('organizations/:organizationId')
export class CampaignWorkspaceController {
  constructor(
    private readonly workspace: CampaignWorkspaceService,
    private readonly duplicates: LeadDuplicatesService,
  ) {}

  @Get('revenue/campaigns/:campaignId/leads')
  leads(
    @Param('organizationId') organizationId: string,
    @Param('campaignId') campaignId: string,
    @Query() query: CampaignLeadsQueryDto,
  ): Promise<Paginated<CampaignLeadRow>> {
    return this.workspace.leads(organizationId, campaignId, query);
  }

  @Get('revenue/campaigns/:campaignId/outreach-messages')
  messages(
    @Param('organizationId') organizationId: string,
    @Param('campaignId') campaignId: string,
    @Query() query: CampaignMessagesQueryDto,
  ): Promise<Paginated<CampaignMessageRow>> {
    return this.workspace.messages(organizationId, campaignId, query);
  }

  @Get('leads/:leadId/campaigns')
  participations(
    @Param('organizationId') organizationId: string,
    @Param('leadId') leadId: string,
  ): Promise<LeadParticipation[]> {
    return this.workspace.participations(organizationId, leadId);
  }

  @Get('lead-duplicates')
  listDuplicates(
    @Param('organizationId') organizationId: string,
    @Query() query: DuplicateCandidatesQueryDto,
  ): Promise<DuplicateCandidateView[]> {
    return this.duplicates.list(organizationId, query);
  }

  @Roles(...WRITE_ROLES)
  @UseGuards(RolesGuard)
  @Post('lead-duplicates/refresh')
  refreshDuplicates(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { id: string },
  ): Promise<{ created: number }> {
    return this.duplicates.refresh(organizationId, user.id);
  }

  @Roles(...WRITE_ROLES)
  @UseGuards(RolesGuard)
  @Post('lead-duplicates/:candidateId/confirm')
  confirmDuplicate(
    @Param('organizationId') organizationId: string,
    @Param('candidateId') candidateId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: ConfirmDuplicateDto,
  ): Promise<LeadDuplicateCandidate> {
    return this.duplicates.confirm(organizationId, candidateId, dto.duplicateLeadId, user.id);
  }

  @Roles(...WRITE_ROLES)
  @UseGuards(RolesGuard)
  @Post('lead-duplicates/:candidateId/dismiss')
  dismissDuplicate(
    @Param('organizationId') organizationId: string,
    @Param('candidateId') candidateId: string,
    @CurrentUser() user: { id: string },
  ): Promise<LeadDuplicateCandidate> {
    return this.duplicates.dismiss(organizationId, candidateId, user.id);
  }

  @Roles(...WRITE_ROLES)
  @UseGuards(RolesGuard)
  @Post('lead-duplicates/:candidateId/reopen')
  reopenDuplicate(
    @Param('organizationId') organizationId: string,
    @Param('candidateId') candidateId: string,
    @CurrentUser() user: { id: string },
  ): Promise<LeadDuplicateCandidate> {
    return this.duplicates.reopen(organizationId, candidateId, user.id);
  }
}
