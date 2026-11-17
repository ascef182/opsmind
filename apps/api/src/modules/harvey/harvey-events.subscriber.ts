import { Injectable, Logger, OnModuleDestroy, type MessageEvent } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import IORedis from 'ioredis';
import { Observable, Subject, filter, interval, map, merge } from 'rxjs';
import { harveyChannel, type HarveyStreamEvent } from '@opsmind/shared-types';
import type { Env } from '@opsmind/config/env/schema';

export const HARVEY_KEEPALIVE_MS = 25_000;
const CHANNEL_PATTERN = harveyChannel('*');
const CHANNEL_PREFIX = harveyChannel('');

interface IncomingEvent {
  organizationId: string;
  event: HarveyStreamEvent;
}

// Uma assinatura Redis por instância da API, repassada aos streams abertos. O
// filtro por organização acontece aqui; o canal vem do Redis, nunca do cliente.
@Injectable()
export class HarveyEventsSubscriber implements OnModuleDestroy {
  private readonly logger = new Logger(HarveyEventsSubscriber.name);
  private readonly incoming = new Subject<IncomingEvent>();
  private connection: IORedis | null = null;

  constructor(private readonly configService: ConfigService<Env, true>) {}

  private ensureSubscribed(): void {
    if (this.connection) return;
    this.connection = new IORedis(this.configService.get('REDIS_URL', { infer: true }), {
      maxRetriesPerRequest: null,
    });
    this.connection.on('pmessage', (_pattern: string, channel: string, message: string) =>
      this.handle(channel, message),
    );
    void this.connection.psubscribe(CHANNEL_PATTERN).catch((error: unknown) => {
      this.logger.error(`Falha ao assinar eventos do Harvey: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  handle(channel: string, message: string): void {
    if (!channel.startsWith(CHANNEL_PREFIX)) return;
    try {
      this.incoming.next({ organizationId: channel.slice(CHANNEL_PREFIX.length), event: JSON.parse(message) });
    } catch {
      this.logger.warn('Evento do Harvey ignorado (JSON inválido)');
    }
  }

  stream(organizationId: string): Observable<MessageEvent> {
    this.ensureSubscribed();
    const events = this.incoming.pipe(
      filter((incoming) => incoming.organizationId === organizationId),
      map(({ event }): MessageEvent => ({
        type: event.kind,
        data: event,
        ...(event.kind === 'activity' ? { id: event.activity.id } : {}),
      })),
    );
    const keepAlive = interval(HARVEY_KEEPALIVE_MS).pipe(map((): MessageEvent => ({ type: 'ping', data: '' })));
    return merge(events, keepAlive);
  }

  onModuleDestroy(): void {
    this.incoming.complete();
    this.connection?.disconnect();
  }
}
