import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { WRITE_ROLES } from '../../shared/constants/roles.constant';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { Roles } from '../../shared/decorators/roles.decorator';
import { RolesGuard } from '../../shared/guards/roles.guard';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { FINANCE_WRITE_ROLE } from '../finance/finance.constants';
import {
  ChangeOpportunityStatusDto,
  ConvertOpportunityDto,
  CreateOpportunityDto,
  CreateRequirementDto,
  CreateTechnicalCertificateDto,
  UpdateOpportunityDto,
  UpdateRequirementDto,
  UpdateTechnicalCertificateDto,
} from './dto/procurement.dto';
import {
  ProcurementService,
  type OpportunityDetail,
  type OpportunitySummary,
  type ProcurementOverview,
  type RequirementView,
} from './procurement.service';
import { TechnicalCertificatesService, type TechnicalCertificateView } from './technical-certificates.service';

// Leitura para todo membro; escrita para WRITE_ROLES. Converter em cliente +
// contrato cria dado financeiro, então segue o papel de escrita do Financeiro.
@UseGuards(TenantGuard, RolesGuard)
@Controller('organizations/:organizationId/opsgov')
export class ProcurementController {
  constructor(
    private readonly procurement: ProcurementService,
    private readonly technicalCertificates: TechnicalCertificatesService,
  ) {}

  @Get('readiness')
  overview(@Param('organizationId') organizationId: string): Promise<ProcurementOverview> {
    return this.procurement.overview(organizationId);
  }

  @Get('technical-certificates')
  listTechnicalCertificates(@Param('organizationId') organizationId: string): Promise<TechnicalCertificateView[]> {
    return this.technicalCertificates.list(organizationId);
  }

  @Roles(...WRITE_ROLES)
  @Post('technical-certificates')
  createTechnicalCertificate(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: CreateTechnicalCertificateDto,
  ): Promise<TechnicalCertificateView> {
    return this.technicalCertificates.create(organizationId, dto, { type: 'USER', id: user.id });
  }

  @Roles(...WRITE_ROLES)
  @Patch('technical-certificates/:certificateId')
  updateTechnicalCertificate(
    @Param('organizationId') organizationId: string,
    @Param('certificateId', ParseUUIDPipe) certificateId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: UpdateTechnicalCertificateDto,
  ): Promise<TechnicalCertificateView> {
    return this.technicalCertificates.update(organizationId, certificateId, dto, { type: 'USER', id: user.id });
  }

  @Get('procurement')
  listOpportunities(@Param('organizationId') organizationId: string): Promise<OpportunitySummary[]> {
    return this.procurement.listOpportunities(organizationId);
  }

  @Roles(...WRITE_ROLES)
  @Post('procurement')
  createOpportunity(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: CreateOpportunityDto,
  ): Promise<OpportunityDetail> {
    return this.procurement.createOpportunity(organizationId, dto, { type: 'USER', id: user.id });
  }

  @Get('procurement/:opportunityId')
  getOpportunity(
    @Param('organizationId') organizationId: string,
    @Param('opportunityId', ParseUUIDPipe) opportunityId: string,
  ): Promise<OpportunityDetail> {
    return this.procurement.getOpportunity(organizationId, opportunityId);
  }

  @Roles(...WRITE_ROLES)
  @Patch('procurement/:opportunityId')
  updateOpportunity(
    @Param('organizationId') organizationId: string,
    @Param('opportunityId', ParseUUIDPipe) opportunityId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: UpdateOpportunityDto,
  ): Promise<OpportunityDetail> {
    return this.procurement.updateOpportunity(organizationId, opportunityId, dto, { type: 'USER', id: user.id });
  }

  @Roles(...WRITE_ROLES)
  @Post('procurement/:opportunityId/status')
  changeStatus(
    @Param('organizationId') organizationId: string,
    @Param('opportunityId', ParseUUIDPipe) opportunityId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: ChangeOpportunityStatusDto,
  ): Promise<OpportunityDetail> {
    return this.procurement.changeStatus(organizationId, opportunityId, dto, { type: 'USER', id: user.id });
  }

  @Roles(...WRITE_ROLES)
  @Post('procurement/:opportunityId/requirements')
  addRequirement(
    @Param('organizationId') organizationId: string,
    @Param('opportunityId', ParseUUIDPipe) opportunityId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: CreateRequirementDto,
  ): Promise<RequirementView> {
    return this.procurement.addRequirement(organizationId, opportunityId, dto, { type: 'USER', id: user.id });
  }

  @Roles(...WRITE_ROLES)
  @Patch('procurement/:opportunityId/requirements/:requirementId')
  updateRequirement(
    @Param('organizationId') organizationId: string,
    @Param('opportunityId', ParseUUIDPipe) opportunityId: string,
    @Param('requirementId', ParseUUIDPipe) requirementId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: UpdateRequirementDto,
  ): Promise<RequirementView> {
    return this.procurement.updateRequirement(organizationId, opportunityId, requirementId, dto, {
      type: 'USER',
      id: user.id,
    });
  }

  @Roles(...WRITE_ROLES)
  @Delete('procurement/:opportunityId/requirements/:requirementId')
  @HttpCode(204)
  removeRequirement(
    @Param('organizationId') organizationId: string,
    @Param('opportunityId', ParseUUIDPipe) opportunityId: string,
    @Param('requirementId', ParseUUIDPipe) requirementId: string,
    @CurrentUser() user: { id: string },
  ): Promise<void> {
    return this.procurement.removeRequirement(organizationId, opportunityId, requirementId, { type: 'USER', id: user.id });
  }

  @Roles(FINANCE_WRITE_ROLE)
  @Post('procurement/:opportunityId/convert')
  convert(
    @Param('organizationId') organizationId: string,
    @Param('opportunityId', ParseUUIDPipe) opportunityId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: ConvertOpportunityDto,
  ): Promise<OpportunityDetail> {
    return this.procurement.convert(organizationId, opportunityId, dto, { type: 'USER', id: user.id });
  }
}
