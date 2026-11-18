import { Module } from '@nestjs/common';
import { RolesGuard } from '../../shared/guards/roles.guard';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { CompanyProfileController } from './company-profile.controller';
import { CompanyProfileService } from './company-profile.service';

@Module({
  controllers: [CompanyProfileController],
  providers: [CompanyProfileService, TenantGuard, RolesGuard],
  exports: [CompanyProfileService],
})
export class OpsGovModule {}
