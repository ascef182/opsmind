import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import type { OutreachMessage } from '@opsmind/database';
import { OutreachService } from './outreach.service';
import { GenerateOutreachDto } from './dto/generate-outreach.dto';
import { RejectOutreachDto } from './dto/reject-outreach.dto';
import { ListOutreachMessagesQueryDto } from './dto/list-outreach-messages-query.dto';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { RolesGuard } from '../../shared/guards/roles.guard';
import { Roles } from '../../shared/decorators/roles.decorator';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { WRITE_ROLES } from '../../shared/constants/roles.constant';

/**
 * Todas as transições de estado (approve/reject/regenerate/mark-sent/
 * mark-replied) exigem `@Roles(...WRITE_ROLES)` + `RolesGuard` — o mesmo
 * humano autenticado que passou pelo `JwtAuthGuard` global. Não existe (nem
 * pode existir) uma rota equivalente chamável pela IA — ver o comentário de
 * topo de `outreach.service.ts`.
 */
@UseGuards(TenantGuard)
@Controller('organizations/:organizationId')
export class OutreachMessagesController {
  constructor(private readonly outreachService: OutreachService) {}

  @Roles(...WRITE_ROLES)
  @UseGuards(RolesGuard)
  @Post('leads/:leadId/outreach-messages')
  generateDraft(
    @Param('organizationId') organizationId: string,
    @Param('leadId') leadId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: GenerateOutreachDto,
  ): Promise<OutreachMessage> {
    return this.outreachService.generateDraft(organizationId, leadId, dto, user.id);
  }

  @Get('leads/:leadId/outreach-messages')
  listForLead(
    @Param('organizationId') organizationId: string,
    @Param('leadId') leadId: string,
  ): Promise<OutreachMessage[]> {
    return this.outreachService.listForLead(organizationId, leadId);
  }

  // Fila de revisão global — ?status=DRAFT lista tudo que ainda precisa de
  // decisão humana, independente do lead.
  @Get('outreach-messages')
  list(
    @Param('organizationId') organizationId: string,
    @Query() query: ListOutreachMessagesQueryDto,
  ): Promise<OutreachMessage[]> {
    return this.outreachService.list(organizationId, query.status);
  }

  @Get('outreach-messages/:messageId')
  findOne(
    @Param('organizationId') organizationId: string,
    @Param('messageId') messageId: string,
  ): Promise<OutreachMessage> {
    return this.outreachService.findByIdOrThrow(organizationId, messageId);
  }

  @Roles(...WRITE_ROLES)
  @UseGuards(RolesGuard)
  @Post('outreach-messages/:messageId/approve')
  approve(
    @Param('organizationId') organizationId: string,
    @Param('messageId') messageId: string,
    @CurrentUser() user: { id: string },
  ): Promise<OutreachMessage> {
    return this.outreachService.approve(organizationId, messageId, user.id);
  }

  @Roles(...WRITE_ROLES)
  @UseGuards(RolesGuard)
  @Post('outreach-messages/:messageId/reject')
  reject(
    @Param('organizationId') organizationId: string,
    @Param('messageId') messageId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: RejectOutreachDto,
  ): Promise<OutreachMessage> {
    return this.outreachService.reject(organizationId, messageId, dto, user.id);
  }

  @Roles(...WRITE_ROLES)
  @UseGuards(RolesGuard)
  @Post('outreach-messages/:messageId/regenerate')
  regenerate(
    @Param('organizationId') organizationId: string,
    @Param('messageId') messageId: string,
    @CurrentUser() user: { id: string },
  ): Promise<OutreachMessage> {
    return this.outreachService.regenerate(organizationId, messageId, user.id);
  }

  @Roles(...WRITE_ROLES)
  @UseGuards(RolesGuard)
  @Post('outreach-messages/:messageId/mark-sent')
  markSent(
    @Param('organizationId') organizationId: string,
    @Param('messageId') messageId: string,
    @CurrentUser() user: { id: string },
  ): Promise<OutreachMessage> {
    return this.outreachService.markSent(organizationId, messageId, user.id);
  }

  @Roles(...WRITE_ROLES)
  @UseGuards(RolesGuard)
  @Post('outreach-messages/:messageId/mark-replied')
  markReplied(
    @Param('organizationId') organizationId: string,
    @Param('messageId') messageId: string,
    @CurrentUser() user: { id: string },
  ): Promise<OutreachMessage> {
    return this.outreachService.markReplied(organizationId, messageId, user.id);
  }
}
