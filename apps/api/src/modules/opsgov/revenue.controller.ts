import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { Roles } from '../../shared/decorators/roles.decorator';
import { RolesGuard } from '../../shared/guards/roles.guard';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { FINANCE_READ_ROLE } from '../finance/finance.constants';
import { ClassifyRevenueDto, Rbt12QueryDto, RevenueByActivityQueryDto, UnclassifiedQueryDto } from './dto/revenue.dto';
import type { RevenueByActivity } from './revenue-by-activity';
import { RevenueService, type Rbt12View, type UnclassifiedEntry } from './revenue.service';

// Faturamento é dado financeiro: leitura E classificação ficam em MANAGER+
// (subconjunto de WRITE_ROLES) — classificar exige enxergar os lançamentos.
@UseGuards(TenantGuard, RolesGuard)
@Roles(FINANCE_READ_ROLE)
@Controller('organizations/:organizationId/opsgov/revenue')
export class RevenueController {
  constructor(private readonly revenue: RevenueService) {}

  @Get('unclassified')
  unclassified(@Param('organizationId') organizationId: string, @Query() query: UnclassifiedQueryDto): Promise<UnclassifiedEntry[]> {
    return this.revenue.listUnclassified(organizationId, query);
  }

  @Patch('classify')
  classify(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: ClassifyRevenueDto,
  ): Promise<{ classified: number }> {
    return this.revenue.classify(organizationId, dto, { type: 'USER', id: user.id });
  }

  @Get('by-activity')
  byActivity(@Param('organizationId') organizationId: string, @Query() query: RevenueByActivityQueryDto): Promise<RevenueByActivity> {
    return this.revenue.byActivity(organizationId, query);
  }

  @Get('rbt12')
  rbt12(@Param('organizationId') organizationId: string, @Query() query: Rbt12QueryDto): Promise<Rbt12View> {
    return this.revenue.rbt12(organizationId, query);
  }
}
