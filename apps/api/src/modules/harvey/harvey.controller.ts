import { Body, Controller, Get, Param, Post, Query, Sse, UseGuards, type MessageEvent } from '@nestjs/common';
import type { Observable } from 'rxjs';
import type { HarveyActivityEvent } from '@opsmind/shared-types';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { RolesGuard } from '../../shared/guards/roles.guard';
import { Roles } from '../../shared/decorators/roles.decorator';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { SkipTenantTransaction } from '../../shared/decorators/skip-tenant-transaction.decorator';
import { HarveyControlService, type HarveySnapshot } from './harvey-control.service';
import { HarveyEventsSubscriber } from './harvey-events.subscriber';
import { HarveyCommandDto, ListHarveyActivitiesQueryDto } from './dto/harvey-command.dto';

// Leitura para qualquer membro; comandos só OWNER/ADMIN.
@UseGuards(TenantGuard)
@Controller('organizations/:organizationId/revenue/harvey')
export class HarveyController {
  constructor(
    private readonly controlService: HarveyControlService,
    private readonly subscriber: HarveyEventsSubscriber,
  ) {}

  @Get()
  snapshot(@Param('organizationId') organizationId: string): Promise<HarveySnapshot> {
    return this.controlService.snapshot(organizationId);
  }

  @Roles('OWNER', 'ADMIN')
  @UseGuards(RolesGuard)
  @Post('commands')
  command(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: HarveyCommandDto,
  ): Promise<HarveySnapshot> {
    return this.controlService.command(organizationId, dto.command, user.id, dto.reason);
  }

  @Get('activities')
  activities(
    @Param('organizationId') organizationId: string,
    @Query() query: ListHarveyActivitiesQueryDto,
  ): Promise<{ items: HarveyActivityEvent[]; nextCursor: string | null }> {
    return this.controlService.listActivities(organizationId, query);
  }

  // Sem transação: o stream fica aberto por horas. TenantGuard já validou a
  // organização antes; nada aqui consulta o banco.
  @SkipTenantTransaction()
  @Sse('stream')
  stream(@Param('organizationId') organizationId: string): Observable<MessageEvent> {
    return this.subscriber.stream(organizationId);
  }
}
