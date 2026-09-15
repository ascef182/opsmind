import { Module } from '@nestjs/common';
import { MeetingsService } from './meetings.service';
import { MeetingsController } from './meetings.controller';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { RolesGuard } from '../../shared/guards/roles.guard';

@Module({
  controllers: [MeetingsController],
  providers: [MeetingsService, TenantGuard, RolesGuard],
  exports: [MeetingsService],
})
export class MeetingsModule {}
