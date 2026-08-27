import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { Invitation, Membership } from '@opsmind/database';
import { InvitationsService, type PendingInvitation } from './invitations.service';
import { MembershipsService, type MembershipWithUser } from './memberships.service';
import { InviteMemberDto } from './dto/invite-member.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { RolesGuard } from '../../shared/guards/roles.guard';
import { Roles } from '../../shared/decorators/roles.decorator';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { CurrentMembership } from '../../shared/decorators/current-membership.decorator';

// TenantGuard no controller inteiro: toda rota aqui é aninhada sob uma
// organização e exige vínculo. RolesGuard entra por rota, onde a ação exige
// um papel mínimo (invite/update/remove) — list é aberta a qualquer membro.
@UseGuards(TenantGuard)
@Controller('organizations/:organizationId')
export class MembershipsController {
  constructor(
    private readonly invitationsService: InvitationsService,
    private readonly membershipsService: MembershipsService,
  ) {}

  @Roles('OWNER', 'ADMIN')
  @UseGuards(RolesGuard)
  @Post('invite')
  invite(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { id: string },
    @CurrentMembership() membership: Membership,
    @Body() dto: InviteMemberDto,
  ): Promise<Invitation> {
    return this.invitationsService.create({
      organizationId,
      invitedByUserId: user.id,
      inviterRole: membership.role,
      email: dto.email,
      role: dto.role,
    });
  }

  @Get('members')
  listMembers(@Param('organizationId') organizationId: string): Promise<MembershipWithUser[]> {
    return this.membershipsService.listForOrganization(organizationId);
  }

  // Mesma restrição do próprio convite (OWNER/ADMIN): a lista expõe e-mails
  // de gente que ainda nem é membro, então segue o mesmo nível de acesso de
  // quem gerencia a equipe — não o de "qualquer membro pode ver".
  @Roles('OWNER', 'ADMIN')
  @UseGuards(RolesGuard)
  @Get('invitations')
  listPendingInvitations(
    @Param('organizationId') organizationId: string,
  ): Promise<PendingInvitation[]> {
    return this.invitationsService.listPendingForOrganization(organizationId);
  }

  @Roles('OWNER', 'ADMIN')
  @UseGuards(RolesGuard)
  @Patch('members/:userId')
  updateRole(
    @Param('organizationId') organizationId: string,
    @Param('userId') userId: string,
    @CurrentMembership() membership: Membership,
    @Body() dto: UpdateMemberRoleDto,
  ): Promise<Membership> {
    return this.membershipsService.updateRole(organizationId, userId, dto.role, membership);
  }

  @Roles('OWNER', 'ADMIN')
  @UseGuards(RolesGuard)
  @HttpCode(204)
  @Delete('members/:userId')
  async remove(
    @Param('organizationId') organizationId: string,
    @Param('userId') userId: string,
    @CurrentMembership() membership: Membership,
  ) {
    await this.membershipsService.remove(organizationId, userId, membership);
  }
}
