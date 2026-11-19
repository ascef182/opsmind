import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { WRITE_ROLES } from '../../shared/constants/roles.constant';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { Roles } from '../../shared/decorators/roles.decorator';
import { RolesGuard } from '../../shared/guards/roles.guard';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { ComplianceService, type CertificateView, type ObligationView } from './compliance.service';
import {
  CompleteObligationDto,
  CreateCertificateDto,
  CreateObligationDto,
  DismissObligationDto,
  UpdateCertificateDto,
  UpdateObligationDto,
} from './dto/compliance.dto';

// Leitura para todo membro; escrita para WRITE_ROLES. Marcar certidão ou
// cumprir obrigação é sempre ação humana por esta rota — nunca por AI tool.
@UseGuards(TenantGuard, RolesGuard)
@Controller('organizations/:organizationId/opsgov/compliance')
export class ComplianceController {
  constructor(private readonly compliance: ComplianceService) {}

  @Get('obligations')
  listObligations(@Param('organizationId') organizationId: string): Promise<ObligationView[]> {
    return this.compliance.listObligations(organizationId);
  }

  @Roles(...WRITE_ROLES)
  @Post('obligations')
  createObligation(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: CreateObligationDto,
  ): Promise<ObligationView> {
    return this.compliance.createObligation(organizationId, dto, { type: 'USER', id: user.id });
  }

  @Roles(...WRITE_ROLES)
  @Patch('obligations/:obligationId')
  updateObligation(
    @Param('organizationId') organizationId: string,
    @Param('obligationId', ParseUUIDPipe) obligationId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: UpdateObligationDto,
  ): Promise<ObligationView> {
    return this.compliance.updateObligation(organizationId, obligationId, dto, { type: 'USER', id: user.id });
  }

  @Roles(...WRITE_ROLES)
  @Post('obligations/:obligationId/complete')
  completeObligation(
    @Param('organizationId') organizationId: string,
    @Param('obligationId', ParseUUIDPipe) obligationId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: CompleteObligationDto,
  ): Promise<ObligationView> {
    return this.compliance.completeObligation(organizationId, obligationId, dto, { type: 'USER', id: user.id });
  }

  @Roles(...WRITE_ROLES)
  @Post('obligations/:obligationId/dismiss')
  dismissObligation(
    @Param('organizationId') organizationId: string,
    @Param('obligationId', ParseUUIDPipe) obligationId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: DismissObligationDto,
  ): Promise<ObligationView> {
    return this.compliance.dismissObligation(organizationId, obligationId, dto, { type: 'USER', id: user.id });
  }

  @Get('certificates')
  listCertificates(@Param('organizationId') organizationId: string): Promise<CertificateView[]> {
    return this.compliance.listCertificates(organizationId);
  }

  @Roles(...WRITE_ROLES)
  @Post('certificates')
  createCertificate(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: CreateCertificateDto,
  ): Promise<CertificateView> {
    return this.compliance.createCertificate(organizationId, dto, { type: 'USER', id: user.id });
  }

  @Roles(...WRITE_ROLES)
  @Patch('certificates/:certificateId')
  updateCertificate(
    @Param('organizationId') organizationId: string,
    @Param('certificateId', ParseUUIDPipe) certificateId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: UpdateCertificateDto,
  ): Promise<CertificateView> {
    return this.compliance.updateCertificate(organizationId, certificateId, dto, { type: 'USER', id: user.id });
  }
}
