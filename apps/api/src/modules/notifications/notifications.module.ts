import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { TenantGuard } from '../../shared/guards/tenant.guard';

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, TenantGuard],
  exports: [NotificationsService],
})
export class NotificationsModule {}
