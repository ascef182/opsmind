import { Module } from '@nestjs/common';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { RolesGuard } from '../../shared/guards/roles.guard';
import { HarveyOrchestratorQueueService } from '../../infrastructure/queue/harvey-orchestrator-queue.service';
import { CampaignsController } from './campaigns.controller';
import { HarveyController } from './harvey.controller';
import { HarveyControlService } from './harvey-control.service';
import { HarveyEventsSubscriber } from './harvey-events.subscriber';

@Module({
  controllers: [HarveyController, CampaignsController],
  providers: [HarveyControlService, HarveyEventsSubscriber, HarveyOrchestratorQueueService, TenantGuard, RolesGuard],
})
export class HarveyModule {}
