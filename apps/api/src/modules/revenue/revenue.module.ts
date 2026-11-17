import { Module } from '@nestjs/common';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { RolesGuard } from '../../shared/guards/roles.guard';
import { RevenueController } from './revenue.controller';
import { RevenueService } from './revenue.service';

// `RevenueSettingsService`/`PipelineHistoryService` vêm do `RevenueCoreModule`
// (global); este módulo só expõe as leituras do painel.
@Module({
  controllers: [RevenueController],
  providers: [RevenueService, TenantGuard, RolesGuard],
})
export class RevenueModule {}
