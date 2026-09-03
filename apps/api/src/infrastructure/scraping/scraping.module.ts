import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  APIFY_GATEWAY,
  ApifyGatewayService,
  type ApifyGateway,
  CAMOFOX_GATEWAY,
  CamofoxGatewayService,
  type CamofoxGateway,
  EXPLORIUM_GATEWAY,
  ExploriumGatewayService,
  type ExploriumGateway,
} from '@opsmind/integrations';
import type { Env } from '@opsmind/config/env/schema';

/**
 * Wrapper de DI dos 3 gateways de `@opsmind/integrations` para `apps/api`
 * (que só usa `ExploriumGateway.matchBusiness` sob demanda em
 * `LeadsService.enrich` — Apify/Camoufox são consumidos de verdade só por
 * `apps/worker`, mas os 3 tokens são registrados aqui para: (a) manter o
 * módulo simétrico/fácil de estender caso a api passe a chamar outra fonte
 * diretamente, e (b) permitir que testes e2e sobrescrevam qualquer um dos
 * três via `overrideProvider`, mesmo padrão de `AI_GATEWAY`.
 *
 * Cada credencial (`APIFY_API_TOKEN`/`EXPLORIUM_API_KEY`/`CAMOFOX_API_URL`)
 * é opcional no schema de env (mesmo espírito de `ANTHROPIC_API_KEY`) — a
 * app não deve recusar subir só porque uma organização não usa uma fonte
 * específica. Por isso a ausência da credencial não lança aqui na
 * construção: o gateway retornado lança um erro claro só quando um método
 * de fato é chamado sem a credencial configurada (fail-late, fail-clear).
 */
@Module({
  providers: [
    {
      provide: APIFY_GATEWAY,
      useFactory: (configService: ConfigService<Env, true>): ApifyGateway => {
        const apiToken = configService.get('APIFY_API_TOKEN', { infer: true });
        const actorId = configService.get('APIFY_GOOGLE_MAPS_ACTOR_ID', { infer: true });
        if (!apiToken) {
          return {
            searchBusinesses: () => {
              throw new Error(
                'APIFY_API_TOKEN não configurado — necessário para ScrapeJob com sourceType=APIFY_GOOGLE_MAPS.',
              );
            },
          };
        }
        return new ApifyGatewayService(apiToken, actorId);
      },
      inject: [ConfigService],
    },
    {
      provide: EXPLORIUM_GATEWAY,
      useFactory: (configService: ConfigService<Env, true>): ExploriumGateway => {
        const apiKey = configService.get('EXPLORIUM_API_KEY', { infer: true });
        if (!apiKey) {
          return {
            searchBusinesses: () => {
              throw new Error(
                'EXPLORIUM_API_KEY não configurado — necessário para ScrapeJob com sourceType=EXPLORIUM_BUSINESS_SEARCH.',
              );
            },
            matchBusiness: () => {
              throw new Error(
                'EXPLORIUM_API_KEY não configurado — necessário para enriquecer um lead via Explorium.',
              );
            },
          };
        }
        return new ExploriumGatewayService(apiKey);
      },
      inject: [ConfigService],
    },
    {
      provide: CAMOFOX_GATEWAY,
      useFactory: (configService: ConfigService<Env, true>): CamofoxGateway => {
        const baseUrl = configService.get('CAMOFOX_API_URL', { infer: true });
        const accessKey = configService.get('CAMOFOX_ACCESS_KEY', { infer: true });
        if (!baseUrl) {
          return {
            search: () => {
              throw new Error(
                'CAMOFOX_API_URL não configurado — necessário para ScrapeJob com sourceType=CAMOFOX_GOOGLE_SEARCH/CAMOFOX_REDDIT_SEARCH.',
              );
            },
          };
        }
        return new CamofoxGatewayService(baseUrl, accessKey);
      },
      inject: [ConfigService],
    },
  ],
  exports: [APIFY_GATEWAY, EXPLORIUM_GATEWAY, CAMOFOX_GATEWAY],
})
export class ScrapingModule {}
