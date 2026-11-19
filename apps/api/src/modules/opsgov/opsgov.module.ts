import { Module } from '@nestjs/common';
import { RolesGuard } from '../../shared/guards/roles.guard';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { FinanceModule } from '../finance/finance.module';
import { AccountingController } from './accounting.controller';
import { AccountingService } from './accounting.service';
import { CompanyProfileController } from './company-profile.controller';
import { CompanyProfileService } from './company-profile.service';
import { ComplianceController } from './compliance.controller';
import { ComplianceService } from './compliance.service';
import { RevenueController } from './revenue.controller';
import { RevenueService } from './revenue.service';
import { SimplesController } from './simples.controller';
import { SimplesService } from './simples.service';

@Module({
  imports: [FinanceModule],
  controllers: [CompanyProfileController, RevenueController, SimplesController, ComplianceController, AccountingController],
  providers: [CompanyProfileService, RevenueService, SimplesService, ComplianceService, AccountingService, TenantGuard, RolesGuard],
  exports: [CompanyProfileService, RevenueService, SimplesService, ComplianceService, AccountingService],
})
export class OpsGovModule {}
