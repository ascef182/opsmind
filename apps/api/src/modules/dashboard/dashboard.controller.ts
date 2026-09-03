import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { DashboardService, type DashboardOverview, type LeadPipelineOverview } from './dashboard.service';
import { TenantGuard } from '../../shared/guards/tenant.guard';

@UseGuards(TenantGuard)
@Controller('organizations/:organizationId/dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get()
  overview(@Param('organizationId') organizationId: string): Promise<DashboardOverview> {
    return this.dashboardService.getOverview(organizationId);
  }

  // Leitura, sem `@Roles(...WRITE_ROLES)` — mesmo padrão do endpoint acima
  // (`TenantGuard` sozinho já garante que o usuário é membro da organização).
  @Get('leads')
  leadPipelineOverview(@Param('organizationId') organizationId: string): Promise<LeadPipelineOverview> {
    return this.dashboardService.getLeadPipelineOverview(organizationId);
  }
}
