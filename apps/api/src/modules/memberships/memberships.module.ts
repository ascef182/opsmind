import { Module } from '@nestjs/common';
import { EmailModule } from '../../infrastructure/email/email.module';
import { InvitationsService } from './invitations.service';
import { MembershipsService } from './memberships.service';
import { MembershipsController } from './memberships.controller';
import { InvitationsController } from './invitations.controller';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { RolesGuard } from '../../shared/guards/roles.guard';

@Module({
  imports: [EmailModule],
  controllers: [MembershipsController, InvitationsController],
  providers: [InvitationsService, MembershipsService, TenantGuard, RolesGuard],
})
export class MembershipsModule {}
