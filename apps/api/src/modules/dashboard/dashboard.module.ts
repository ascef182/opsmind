import { Module } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';
import { TenantGuard } from '../../shared/guards/tenant.guard';

@Module({
  controllers: [DashboardController],
  providers: [DashboardService, TenantGuard],
  // Exportado pro `AiModule` injetar em `GetSalesForecastTool` (Trilha C).
  exports: [DashboardService],
})
export class DashboardModule {}
