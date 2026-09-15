import { Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { DealsService } from './deals.service';
import { DealProposalService } from './deal-proposal.service';
import { DealsController } from './deals.controller';
import { BudgetService } from '../ai/services/budget.service';
import { AI_GATEWAY } from '../ai/gateway/ai-gateway.interface';
import { ClaudeGatewayService } from '../ai/gateway/claude-gateway.service';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { RolesGuard } from '../../shared/guards/roles.guard';

/**
 * Re-registra `AI_GATEWAY`/`BudgetService` como providers PRÓPRIOS (mesma
 * declaração de `AiModule`/`LeadsModule`) em vez de importar `AiModule` —
 * `AiModule` importa `DealsModule` para expor as AI tools de deal, e o
 * NestJS não aceita um ciclo de import de módulos. `RedisService`
 * (dependência de `BudgetService`) não precisa ser re-registrado aqui
 * porque `RedisModule` é `@Global()`.
 */
@Module({
  imports: [ActivityModule, OrganizationsModule],
  controllers: [DealsController],
  providers: [
    DealsService,
    DealProposalService,
    BudgetService,
    { provide: AI_GATEWAY, useClass: ClaudeGatewayService },
    TenantGuard,
    RolesGuard,
  ],
  exports: [DealsService, DealProposalService],
})
export class DealsModule {}
