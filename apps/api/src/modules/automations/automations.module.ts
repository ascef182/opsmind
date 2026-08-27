import { Module } from '@nestjs/common';
import { AutomationsService } from './automations.service';
import { AutomationsController } from './automations.controller';
import { AutomationQueueService } from '../../infrastructure/queue/automation-queue.service';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { RolesGuard } from '../../shared/guards/roles.guard';

@Module({
  controllers: [AutomationsController],
  providers: [AutomationsService, AutomationQueueService, TenantGuard, RolesGuard],
})
export class AutomationsModule {}
