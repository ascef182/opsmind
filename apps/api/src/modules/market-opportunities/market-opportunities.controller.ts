import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import type { MarketOpportunity } from '@opsmind/database';
import { MarketOpportunitiesService } from './market-opportunities.service';
import { UpdateMarketOpportunityStatusDto } from './dto/update-market-opportunity-status.dto';
import { ListMarketOpportunitiesQueryDto } from './dto/list-market-opportunities-query.dto';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { RolesGuard } from '../../shared/guards/roles.guard';
import { Roles } from '../../shared/decorators/roles.decorator';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { WRITE_ROLES } from '../../shared/constants/roles.constant';

/**
 * Sem `POST`/`DELETE`: `MarketOpportunity` só é criada/atualizada em
 * `mentionCount`/`sourceUrls`/`sampleQuotes` pelo consumer de clustering
 * (`reddit-clustering.consumer.ts`) — o único caminho humano aqui é mudar
 * `status`, ver comentário de topo de `MarketOpportunitiesService`.
 */
@UseGuards(TenantGuard)
@Controller('organizations/:organizationId/market-opportunities')
export class MarketOpportunitiesController {
  constructor(private readonly marketOpportunitiesService: MarketOpportunitiesService) {}

  @Get()
  list(
    @Param('organizationId') organizationId: string,
    @Query() query: ListMarketOpportunitiesQueryDto,
  ): Promise<MarketOpportunity[]> {
    return this.marketOpportunitiesService.list(organizationId, query.status);
  }

  @Get(':id')
  findOne(
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ): Promise<MarketOpportunity> {
    return this.marketOpportunitiesService.findByIdOrThrow(organizationId, id);
  }

  @Roles(...WRITE_ROLES)
  @UseGuards(RolesGuard)
  @Patch(':id/status')
  updateStatus(
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
    @Body() dto: UpdateMarketOpportunityStatusDto,
  ): Promise<MarketOpportunity> {
    return this.marketOpportunitiesService.updateStatus(organizationId, id, dto.status, user.id);
  }
}
