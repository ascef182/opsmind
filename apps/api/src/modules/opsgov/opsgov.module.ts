import { Module } from '@nestjs/common';
import { RolesGuard } from '../../shared/guards/roles.guard';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { FinanceModule } from '../finance/finance.module';
import { CompanyProfileController } from './company-profile.controller';
import { CompanyProfileService } from './company-profile.service';
import { RevenueController } from './revenue.controller';
import { RevenueService } from './revenue.service';

@Module({
  imports: [FinanceModule],
  controllers: [CompanyProfileController, RevenueController],
  providers: [CompanyProfileService, RevenueService, TenantGuard, RolesGuard],
  exports: [CompanyProfileService, RevenueService],
})
export class OpsGovModule {}
