import { Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module';
import { TasksService } from './tasks.service';
import { TasksController } from './tasks.controller';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { RolesGuard } from '../../shared/guards/roles.guard';

@Module({
  imports: [ActivityModule],
  controllers: [TasksController],
  providers: [TasksService, TenantGuard, RolesGuard],
  exports: [TasksService],
})
export class TasksModule {}
