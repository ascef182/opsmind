import { Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module';
import { DealsModule } from '../deals/deals.module';
import { CustomersService } from './customers.service';
import { CustomersController } from './customers.controller';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { RolesGuard } from '../../shared/guards/roles.guard';

@Module({
  imports: [ActivityModule, DealsModule],
  controllers: [CustomersController],
  providers: [CustomersService, TenantGuard, RolesGuard],
  exports: [CustomersService],
})
export class CustomersModule {}
