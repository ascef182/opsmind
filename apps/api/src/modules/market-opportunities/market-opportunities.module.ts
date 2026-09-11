// Módulo `market-opportunities` — sinal de demanda de mercado descoberto por
// clustering de IA sobre menções recorrentes do Reddit (`RedditWatchTopic` →
// `apps/worker` busca e enfileira `reddit-clustering` → este módulo agrupa e
// grava `MarketOpportunity`). Deliberadamente FORA de `LeadsModule`: uma
// `MarketOpportunity` é cross-lead e sem empresa específica associada (um
// ângulo de conteúdo/demanda, não um negócio individual scrapeado) — ver
// plano completo em `docs/superpowers/plans/2026-09-02-leads-prospecting-
// dashboard.md`.
//
// GLOBAL CONSTRAINT — REGRA DURA que qualquer mudança neste módulo precisa
// preservar: uma `MarketOpportunity`, mesmo validada e marcada `PURSUING`
// por um humano, NUNCA vira gatilho de DM em massa para os autores dos
// posts do Reddit que formaram o cluster (e os dados de entrada nem
// carregam identidade de autor — só `distinctAuthorCount`, uma estimativa
// agregada da IA). Ela é sempre: (1) um sinal/ângulo de conteúdo para o
// outreach de negócios locais já existente (`OutreachService`, módulo
// `leads`), ou (2) um insumo para um humano ajustar/criar um
// `ServiceOffering`. Não existe (e não pode existir) uma AI tool ou rota que
// transforme uma `MarketOpportunity` diretamente em mensagens disparadas a
// autores de posts — ver o mesmo tipo de restrição em
// `apps/api/src/modules/leads/outreach.service.ts` (aprovação sempre
// humana) e `OutreachChannel.REDDIT_DM`, que continua existindo só como
// canal de outreach PARA UM LEAD/NEGÓCIO específico, nunca para um autor de
// post do Reddit.
//
// **Re-registra `AI_GATEWAY` e `BudgetService` como providers PRÓPRIOS**
// (mesma duplicação deliberada de `LeadsModule`, ver comentário de topo de
// `apps/api/src/modules/leads/leads.module.ts`) em vez de importar
// `AiModule` — evita o mesmo risco de ciclo de import que motivou a
// duplicação lá (um módulo de feature de IA-adjacente não deve depender de
// `AiModule` importar de volta). `RedisService` (dependência de
// `BudgetService`) e `ConfigService` (dependência de `ClaudeGatewayService`)
// não precisam ser re-registrados aqui porque `RedisModule`/`ConfigModule`
// são `@Global()`.
import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module';
import { RedditWatchTopicsService } from './reddit-watch-topics.service';
import { RedditWatchTopicsController } from './reddit-watch-topics.controller';
import { MarketOpportunitiesService } from './market-opportunities.service';
import { MarketOpportunitiesController } from './market-opportunities.controller';
import { RedditClusteringConsumer } from './reddit-clustering.consumer';
import { BudgetService } from '../ai/services/budget.service';
import { AI_GATEWAY } from '../ai/gateway/ai-gateway.interface';
import { ClaudeGatewayService } from '../ai/gateway/claude-gateway.service';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { RolesGuard } from '../../shared/guards/roles.guard';

@Module({
  imports: [OrganizationsModule],
  controllers: [RedditWatchTopicsController, MarketOpportunitiesController],
  providers: [
    RedditWatchTopicsService,
    MarketOpportunitiesService,
    RedditClusteringConsumer,
    BudgetService,
    { provide: AI_GATEWAY, useClass: ClaudeGatewayService },
    TenantGuard,
    RolesGuard,
  ],
  exports: [RedditWatchTopicsService, MarketOpportunitiesService],
})
export class MarketOpportunitiesModule {}
