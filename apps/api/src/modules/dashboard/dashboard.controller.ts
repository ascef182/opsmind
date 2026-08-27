import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { DashboardService, type DashboardOverview } from './dashboard.service';
import { TenantGuard } from '../../shared/guards/tenant.guard';

@UseGuards(TenantGuard)
@Controller('organizations/:organizationId/dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get()
  overview(@Param('organizationId') organizationId: string): Promise<DashboardOverview> {
    return this.dashboardService.getOverview(organizationId);
  }
}
