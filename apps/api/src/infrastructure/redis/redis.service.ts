import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { Env } from '@opsmind/config/env/schema';

/**
 * Conexão reservada desde a Fase 1 (docker-compose), ociosa até agora — o
 * primeiro uso real é o corte de orçamento de IA (BudgetService). BullMQ
 * (Fase 5) reaproveita a mesma conexão/URL.
 */
@Injectable()
export class RedisService extends Redis implements OnModuleDestroy {
  constructor(configService: ConfigService<Env, true>) {
    super(configService.get('REDIS_URL', { infer: true }));
  }

  async onModuleDestroy() {
    await this.quit();
  }
}
