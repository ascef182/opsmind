import { Module } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { OrganizationsController } from './organizations.controller';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { RolesGuard } from '../../shared/guards/roles.guard';

@Module({
  controllers: [OrganizationsController],
  providers: [OrganizationsService, TenantGuard, RolesGuard],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
