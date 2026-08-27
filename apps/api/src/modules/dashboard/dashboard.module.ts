import { Module } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';
import { TenantGuard } from '../../shared/guards/tenant.guard';

@Module({
  controllers: [DashboardController],
  providers: [DashboardService, TenantGuard],
})
export class DashboardModule {}
