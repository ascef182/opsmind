import { Body, Controller, Get, Header, Param, Patch, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import type { Meeting } from '@opsmind/database';
import { MeetingsService } from './meetings.service';
import { CreateMeetingDto } from './dto/create-meeting.dto';
import { UpdateMeetingDto } from './dto/update-meeting.dto';
import { buildIcs } from './utils/build-ics';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { RolesGuard } from '../../shared/guards/roles.guard';
import { Roles } from '../../shared/decorators/roles.decorator';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { WRITE_ROLES } from '../../shared/constants/roles.constant';

@UseGuards(TenantGuard)
@Controller('organizations/:organizationId')
export class MeetingsController {
  constructor(private readonly meetingsService: MeetingsService) {}

  @Roles(...WRITE_ROLES)
  @UseGuards(RolesGuard)
  @Post('deals/:dealId/meetings')
  create(
    @Param('organizationId') organizationId: string,
    @Param('dealId') dealId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: CreateMeetingDto,
  ): Promise<Meeting> {
    return this.meetingsService.create(organizationId, dealId, dto, user.id);
  }

  @Get('deals/:dealId/meetings')
  list(
    @Param('organizationId') organizationId: string,
    @Param('dealId') dealId: string,
  ): Promise<Meeting[]> {
    return this.meetingsService.list(organizationId, dealId);
  }

  @Get('meetings/:meetingId')
  findOne(
    @Param('organizationId') organizationId: string,
    @Param('meetingId') meetingId: string,
  ): Promise<Meeting> {
    return this.meetingsService.findByIdOrThrow(organizationId, meetingId);
  }

  // `.ics` pra qualquer app de calendário além do Google (que usa o link
  // "quick add" gerado direto no frontend, sem precisar deste endpoint) —
  // ver comentário de `buildIcs`.
  @Get('meetings/:meetingId/ics')
  @Header('Content-Type', 'text/calendar; charset=utf-8')
  async downloadIcs(
    @Param('organizationId') organizationId: string,
    @Param('meetingId') meetingId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const meeting = await this.meetingsService.findByIdOrThrow(organizationId, meetingId);
    res.setHeader('Content-Disposition', `attachment; filename="reuniao-${meeting.id}.ics"`);
    return buildIcs(meeting);
  }

  @Roles(...WRITE_ROLES)
  @UseGuards(RolesGuard)
  @Patch('meetings/:meetingId')
  update(
    @Param('organizationId') organizationId: string,
    @Param('meetingId') meetingId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: UpdateMeetingDto,
  ): Promise<Meeting> {
    return this.meetingsService.update(organizationId, meetingId, dto, user.id);
  }

  @Roles(...WRITE_ROLES)
  @UseGuards(RolesGuard)
  @Post('meetings/:meetingId/cancel')
  cancel(
    @Param('organizationId') organizationId: string,
    @Param('meetingId') meetingId: string,
    @CurrentUser() user: { id: string },
  ): Promise<Meeting> {
    return this.meetingsService.cancel(organizationId, meetingId, user.id);
  }
}
