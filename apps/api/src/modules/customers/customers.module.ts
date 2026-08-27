import { Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module';
import { CustomersService } from './customers.service';
import { CustomersController } from './customers.controller';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { RolesGuard } from '../../shared/guards/roles.guard';

@Module({
  imports: [ActivityModule],
  controllers: [CustomersController],
  providers: [CustomersService, TenantGuard, RolesGuard],
  exports: [CustomersService],
})
export class CustomersModule {}
