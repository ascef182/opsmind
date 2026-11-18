import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { WRITE_ROLES } from '../../shared/constants/roles.constant';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { Roles } from '../../shared/decorators/roles.decorator';
import { RolesGuard } from '../../shared/guards/roles.guard';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { CompanyProfileService } from './company-profile.service';
import {
  AddActivityDto,
  ChangeActivityDto,
  ChangeRegimeDto,
  ChangeRegistrationDto,
  EndActivityDto,
  SnapshotQueryDto,
  UpsertCompanyProfileDto,
} from './dto/company-profile.dto';
import type {
  CompanyActivityView,
  CompanyOverview,
  CompanyProfileView,
  CompanySnapshot,
  RegistrationPeriodView,
  TaxRegimePeriodView,
} from './opsgov.types';

// Cadastro não tem dado financeiro: leitura para todo membro, escrita para
// WRITE_ROLES. Toda mudança de vigência é ação humana por esta rota — não há
// AI tool que escreva aqui.
@UseGuards(TenantGuard, RolesGuard)
@Controller('organizations/:organizationId/opsgov/company')
export class CompanyProfileController {
  constructor(private readonly company: CompanyProfileService) {}

  @Get()
  overview(@Param('organizationId') organizationId: string): Promise<CompanyOverview> {
    return this.company.overview(organizationId);
  }

  @Get('snapshot')
  snapshot(@Param('organizationId') organizationId: string, @Query() query: SnapshotQueryDto): Promise<CompanySnapshot> {
    return this.company.snapshotAt(organizationId, query.date);
  }

  @Roles(...WRITE_ROLES)
  @Put('profile')
  upsertProfile(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: UpsertCompanyProfileDto,
  ): Promise<CompanyProfileView> {
    return this.company.upsertProfile(organizationId, dto, { type: 'USER', id: user.id });
  }

  @Roles(...WRITE_ROLES)
  @Post('registrations')
  changeRegistration(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: ChangeRegistrationDto,
  ): Promise<RegistrationPeriodView> {
    return this.company.changeRegistration(organizationId, dto, { type: 'USER', id: user.id });
  }

  @Roles(...WRITE_ROLES)
  @Post('regimes')
  changeRegime(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: ChangeRegimeDto,
  ): Promise<TaxRegimePeriodView> {
    return this.company.changeRegime(organizationId, dto, { type: 'USER', id: user.id });
  }

  @Roles(...WRITE_ROLES)
  @Post('activities')
  addActivity(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: AddActivityDto,
  ): Promise<CompanyActivityView> {
    return this.company.addActivity(organizationId, dto, { type: 'USER', id: user.id });
  }

  @Roles(...WRITE_ROLES)
  @Post('activities/:activityId/versions')
  changeActivity(
    @Param('organizationId') organizationId: string,
    @Param('activityId', ParseUUIDPipe) activityId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: ChangeActivityDto,
  ): Promise<CompanyActivityView> {
    return this.company.changeActivity(organizationId, activityId, dto, { type: 'USER', id: user.id });
  }

  @Roles(...WRITE_ROLES)
  @Patch('activities/:activityId/end')
  endActivity(
    @Param('organizationId') organizationId: string,
    @Param('activityId', ParseUUIDPipe) activityId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: EndActivityDto,
  ): Promise<CompanyActivityView> {
    return this.company.endActivity(organizationId, activityId, dto, { type: 'USER', id: user.id });
  }
}
