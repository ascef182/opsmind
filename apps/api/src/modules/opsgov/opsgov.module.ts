import { Module } from '@nestjs/common';
import { RolesGuard } from '../../shared/guards/roles.guard';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { CustomersModule } from '../customers/customers.module';
import { FinanceModule } from '../finance/finance.module';
import { AccountingController } from './accounting.controller';
import { AccountingService } from './accounting.service';
import { CompanyProfileController } from './company-profile.controller';
import { CompanyProfileService } from './company-profile.service';
import { ComplianceController } from './compliance.controller';
import { ComplianceService } from './compliance.service';
import { ProcurementController } from './procurement.controller';
import { ProcurementService } from './procurement.service';
import { RevenueController } from './revenue.controller';
import { RevenueService } from './revenue.service';
import { SimplesController } from './simples.controller';
import { SimplesService } from './simples.service';
import { TechnicalCertificatesService } from './technical-certificates.service';

@Module({
  imports: [FinanceModule, CustomersModule],
  controllers: [CompanyProfileController, RevenueController, SimplesController, ComplianceController, AccountingController, ProcurementController],
  providers: [
    CompanyProfileService,
    RevenueService,
    SimplesService,
    ComplianceService,
    AccountingService,
    TechnicalCertificatesService,
    ProcurementService,
    TenantGuard,
    RolesGuard,
  ],
  exports: [
    CompanyProfileService,
    RevenueService,
    SimplesService,
    ComplianceService,
    AccountingService,
    TechnicalCertificatesService,
    ProcurementService,
  ],
})
export class OpsGovModule {}
