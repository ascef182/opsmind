import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import type { SimulationResult } from '@opsmind/shared-types';
import { Roles } from '../../shared/decorators/roles.decorator';
import { RolesGuard } from '../../shared/guards/roles.guard';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { FINANCE_READ_ROLE } from '../finance/finance.constants';
import { RealSimulationQueryDto, SimulationQueryDto } from './dto/simples.dto';
import { SimplesService, type RealSimulation } from './simples.service';

// Só leitura. Cenário livre não usa dado da organização (todo membro);
// cenário real usa o faturamento (MANAGER+).
@UseGuards(TenantGuard, RolesGuard)
@Controller('organizations/:organizationId/opsgov/simples')
export class SimplesController {
  constructor(private readonly simples: SimplesService) {}

  @Get('simulation')
  simulation(@Query() query: SimulationQueryDto): SimulationResult {
    return this.simples.simulate(query);
  }

  @Roles(FINANCE_READ_ROLE)
  @Get('real')
  real(@Param('organizationId') organizationId: string, @Query() query: RealSimulationQueryDto): Promise<RealSimulation> {
    return this.simples.simulateReal(organizationId, query);
  }
}
