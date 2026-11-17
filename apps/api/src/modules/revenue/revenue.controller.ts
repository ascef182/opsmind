import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import type { Prisma } from '@opsmind/database';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { RolesGuard } from '../../shared/guards/roles.guard';
import { Roles } from '../../shared/decorators/roles.decorator';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { AuditService } from '../audit/audit.service';
import {
  RevenueService,
  type RevenueCopyPerformance,
  type RevenueCosts,
  type RevenueOverview,
  type RevenuePipeline,
} from './revenue.service';
import { RevenueSettingsService, type RevenueSettings } from './revenue-settings.service';
import { RevenuePeriodQueryDto } from './dto/revenue-period-query.dto';
import { UpdateRevenueSettingsDto } from './dto/update-revenue-settings.dto';

export type RevenueSettingsResponse = Omit<RevenueSettings, 'engineMonthlyBudgetUsd'> & {
  engineMonthlyBudgetUsd: number;
  globalPause: boolean;
};

// Leituras abertas a qualquer membro (mesmo padrão do dashboard). Mudar a
// configuração — inclusive liberar envio — é decisão de OWNER/ADMIN.
@UseGuards(TenantGuard)
@Controller('organizations/:organizationId/revenue')
export class RevenueController {
  constructor(
    private readonly revenueService: RevenueService,
    private readonly settingsService: RevenueSettingsService,
    private readonly auditService: AuditService,
  ) {}

  @Get('overview')
  overview(
    @Param('organizationId') organizationId: string,
    @Query() query: RevenuePeriodQueryDto,
  ): Promise<RevenueOverview> {
    return this.revenueService.getOverview(organizationId, query.period ?? 'day');
  }

  @Get('pipeline')
  pipeline(@Param('organizationId') organizationId: string): Promise<RevenuePipeline> {
    return this.revenueService.getPipeline(organizationId);
  }

  @Get('costs')
  costs(
    @Param('organizationId') organizationId: string,
    @Query() query: RevenuePeriodQueryDto,
  ): Promise<RevenueCosts> {
    return this.revenueService.getCosts(organizationId, query.period ?? 'month');
  }

  @Get('copy-performance')
  copyPerformance(@Param('organizationId') organizationId: string): Promise<RevenueCopyPerformance> {
    return this.revenueService.getCopyPerformance(organizationId);
  }

  @Get('settings')
  async settings(@Param('organizationId') organizationId: string): Promise<RevenueSettingsResponse> {
    return this.toResponse(await this.settingsService.get(organizationId));
  }

  @Roles('OWNER', 'ADMIN')
  @UseGuards(RolesGuard)
  @Patch('settings')
  async updateSettings(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: UpdateRevenueSettingsDto,
  ): Promise<RevenueSettingsResponse> {
    const before = await this.settingsService.get(organizationId);
    const updated = await this.settingsService.update(organizationId, dto);
    await this.auditService.log({
      actorType: 'USER',
      actorId: user.id,
      organizationId,
      action: 'revenue.settings_updated',
      resource: `Organization:${organizationId}`,
      metadata: {
        changes: { ...dto },
        outreachPausedBefore: before.outreachPaused,
      } as unknown as Prisma.InputJsonValue,
    });
    return this.toResponse(updated);
  }

  private toResponse(settings: RevenueSettings): RevenueSettingsResponse {
    return {
      ...settings,
      engineMonthlyBudgetUsd: Number(settings.engineMonthlyBudgetUsd),
      globalPause: this.settingsService.isGloballyPaused(),
    };
  }
}
