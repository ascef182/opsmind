import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import type { Automation, AutomationRun } from '@opsmind/database';
import { AutomationsService } from './automations.service';
import { CreateAutomationDto } from './dto/create-automation.dto';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { RolesGuard } from '../../shared/guards/roles.guard';
import { Roles } from '../../shared/decorators/roles.decorator';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { WRITE_ROLES } from '../../shared/constants/roles.constant';

// Mesma política de RBAC de customers/tasks/documents: leitura aberta a
// qualquer membro, escrita (criar automação, disparo manual) exige papel
// acima de VIEWER.
@UseGuards(TenantGuard)
@Controller('organizations/:organizationId/automations')
export class AutomationsController {
  constructor(private readonly automationsService: AutomationsService) {}

  @Roles(...WRITE_ROLES)
  @UseGuards(RolesGuard)
  @Post()
  create(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: CreateAutomationDto,
  ): Promise<Automation> {
    return this.automationsService.create(organizationId, user.id, dto);
  }

  @Get()
  list(@Param('organizationId') organizationId: string): Promise<Automation[]> {
    return this.automationsService.list(organizationId);
  }

  @Get(':automationId')
  findOne(
    @Param('organizationId') organizationId: string,
    @Param('automationId') automationId: string,
  ): Promise<Automation> {
    return this.automationsService.findByIdOrThrow(organizationId, automationId);
  }

  @Get(':automationId/runs')
  listRuns(
    @Param('organizationId') organizationId: string,
    @Param('automationId') automationId: string,
  ): Promise<AutomationRun[]> {
    return this.automationsService.listRuns(organizationId, automationId);
  }

  // "Execução manual/teste" (PRD §11) — enfileira na mesma fila BullMQ que o
  // scan periódico do worker consome; não roda nada síncrono aqui.
  @Roles(...WRITE_ROLES)
  @UseGuards(RolesGuard)
  @Post(':automationId/run')
  runNow(
    @Param('organizationId') organizationId: string,
    @Param('automationId') automationId: string,
    @CurrentUser() user: { id: string },
  ): Promise<{ enqueued: number }> {
    return this.automationsService.runNow(organizationId, user.id, automationId);
  }
}
