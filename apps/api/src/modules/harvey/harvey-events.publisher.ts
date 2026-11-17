import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import IORedis from 'ioredis';
import { harveyChannel, type HarveyStreamEvent } from '@opsmind/shared-types';
import type { Env } from '@opsmind/config/env/schema';

// Publica eventos do Harvey no Redis (pub/sub). O banco é a fonte da verdade:
// um evento perdido é recuperado pelo cliente ao reconectar.
@Injectable()
export class HarveyEventsPublisher implements OnModuleDestroy {
  private readonly logger = new Logger(HarveyEventsPublisher.name);
  private readonly connection: IORedis;

  constructor(configService: ConfigService<Env, true>) {
    this.connection = new IORedis(configService.get('REDIS_URL', { infer: true }), {
      maxRetriesPerRequest: 2,
      lazyConnect: true,
    });
  }

  async publish(organizationId: string, event: HarveyStreamEvent): Promise<void> {
    try {
      await this.connection.publish(harveyChannel(organizationId), JSON.stringify(event));
    } catch (error) {
      this.logger.warn(`Falha ao publicar evento do Harvey: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  onModuleDestroy(): void {
    this.connection.disconnect();
  }
}
