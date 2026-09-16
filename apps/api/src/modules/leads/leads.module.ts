import { Module } from '@nestjs/common';
import { ScrapingModule } from '../../infrastructure/scraping/scraping.module';
import { QueueModule } from '../../infrastructure/queue/queue.module';
import { EmailModule } from '../../infrastructure/email/email.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { DealsModule } from '../deals/deals.module';
import { InternalNotesModule } from '../internal-notes/internal-notes.module';
import { ServiceOfferingsService } from './service-offerings.service';
import { ServiceOfferingsController } from './service-offerings.controller';
import { ScrapeJobsService } from './scrape-jobs.service';
import { ScrapeJobsController } from './scrape-jobs.controller';
import { ProspectingTargetsService } from './prospecting-targets.service';
import { ProspectingTargetsController } from './prospecting-targets.controller';
import { LeadsService } from './leads.service';
import { LeadsController } from './leads.controller';
import { OutreachService } from './outreach.service';
import { OutreachMessagesController } from './outreach-messages.controller';
import { LeadAnalysisService } from './lead-analysis.service';
import { OutreachAutodraftConsumer } from './outreach-autodraft.consumer';
import { BudgetService } from '../ai/services/budget.service';
import { AI_GATEWAY } from '../ai/gateway/ai-gateway.interface';
import { ClaudeGatewayService } from '../ai/gateway/claude-gateway.service';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { RolesGuard } from '../../shared/guards/roles.guard';

/**
 * Módulo `leads` (não `prospecting`) — geração de pipeline de prospecção
 * outbound: ServiceOffering (ICP) → ScrapeJob (busca em lote, Task 4) →
 * Lead (scoring determinístico + enrichment + análise de IA opt-in) →
 * OutreachMessage (rascunho de IA + aprovação humana) → conversão em
 * `Customer`.
 *
 * **Re-registra `AI_GATEWAY` e `BudgetService` como providers PRÓPRIOS**
 * (mesma declaração de `AiModule`, `apps/api/src/modules/ai/ai.module.ts`)
 * em vez de importar `AiModule` — `AiModule` vai importar `LeadsModule` na
 * Task 6 (para expor `analyze_lead_potential`/outreach como AI tools), e o
 * NestJS não aceita um ciclo de import de módulos. Duplicar essas duas
 * declarações é o preço dessa decisão; `RedisService` (dependência de
 * `BudgetService`) e `ConfigService` (dependência de `ClaudeGatewayService`)
 * não precisam ser re-registrados aqui porque `RedisModule`/`ConfigModule`
 * são `@Global()`.
 */
@Module({
  imports: [ScrapingModule, QueueModule, EmailModule, OrganizationsModule, DealsModule, InternalNotesModule],
  controllers: [
    ServiceOfferingsController,
    ScrapeJobsController,
    ProspectingTargetsController,
    LeadsController,
    OutreachMessagesController,
  ],
  providers: [
    ServiceOfferingsService,
    ScrapeJobsService,
    ProspectingTargetsService,
    LeadsService,
    OutreachService,
    LeadAnalysisService,
    OutreachAutodraftConsumer,
    BudgetService,
    { provide: AI_GATEWAY, useClass: ClaudeGatewayService },
    TenantGuard,
    RolesGuard,
  ],
  exports: [
    LeadsService,
    ServiceOfferingsService,
    ScrapeJobsService,
    ProspectingTargetsService,
    OutreachService,
    LeadAnalysisService,
  ],
})
export class LeadsModule {}
