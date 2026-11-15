import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { RedditWatchTopic } from '@opsmind/database';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RedditTopicScanQueueService } from '../../infrastructure/queue/reddit-topic-scan-queue.service';
import { CreateRedditWatchTopicDto } from './dto/create-reddit-watch-topic.dto';
import { UpdateRedditWatchTopicDto } from './dto/update-reddit-watch-topic.dto';

export interface ListRedditWatchTopicsFilter {
  isActive?: boolean;
}

/**
 * CRUD de `RedditWatchTopic` — adaptado quase verbatim de
 * `ServiceOfferingsService`: sem repository layer, `PrismaService` direto,
 * audit log em toda mutação. O sweep diário do worker
 * (`apps/worker/src/reddit-mining-scan.ts`) continua varrendo TODOS os
 * tópicos ativos — mas criar/reativar um tópico aqui também enfileira um
 * scan imediato (`triggerScan` abaixo, fila `reddit-topic-scan`), mesmo
 * padrão de `ProspectingTargetsService` (Trilha "monitoramento não
 * funciona", plano pensando-como-empresa-com-agile-beaver.md).
 */
@Injectable()
export class RedditWatchTopicsService {
  private readonly logger = new Logger(RedditWatchTopicsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly scanQueueService: RedditTopicScanQueueService,
  ) {}

  async create(
    organizationId: string,
    dto: CreateRedditWatchTopicDto,
    actorUserId: string,
  ): Promise<RedditWatchTopic> {
    const topic = await this.prisma.redditWatchTopic.create({
      data: { organizationId, ...dto },
    });

    await this.auditService.log({
      actorType: 'USER',
      actorId: actorUserId,
      organizationId,
      action: 'reddit_watch_topic.created',
      resource: `RedditWatchTopic:${topic.id}`,
    });

    if (topic.isActive) {
      await this.triggerScan(organizationId, topic.id);
    }

    return topic;
  }

  async findByIdOrThrow(organizationId: string, id: string): Promise<RedditWatchTopic> {
    const topic = await this.prisma.redditWatchTopic.findFirst({
      where: { id, organizationId },
    });
    if (!topic) {
      throw new NotFoundException('Tópico de monitoramento do Reddit não encontrado');
    }
    return topic;
  }

  list(
    organizationId: string,
    filter: ListRedditWatchTopicsFilter = {},
  ): Promise<RedditWatchTopic[]> {
    return this.prisma.redditWatchTopic.findMany({
      where: {
        organizationId,
        ...(filter.isActive !== undefined ? { isActive: filter.isActive } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async update(
    organizationId: string,
    id: string,
    dto: UpdateRedditWatchTopicDto,
    actorUserId: string,
  ): Promise<RedditWatchTopic> {
    const existing = await this.findByIdOrThrow(organizationId, id);

    const updated = await this.prisma.redditWatchTopic.update({ where: { id }, data: dto });

    await this.auditService.log({
      actorType: 'USER',
      actorId: actorUserId,
      organizationId,
      action: 'reddit_watch_topic.updated',
      resource: `RedditWatchTopic:${id}`,
      metadata: { ...dto },
    });

    // Reativação (false -> true) = "quero verificar de novo agora" — mesmo
    // gatilho de `create()`.
    if (!existing.isActive && updated.isActive) {
      await this.triggerScan(organizationId, id);
    }

    return updated;
  }

  /**
   * Dispara um scan manual "agora" pro tópico, ignorando `isActive` (ação
   * explícita do usuário) — retorna `null` (não lança) quando enfileirar
   * falha, mesmo padrão de `ProspectingTargetsService.runNow`.
   */
  async runNow(organizationId: string, id: string, actorUserId: string): Promise<unknown> {
    await this.findByIdOrThrow(organizationId, id);

    await this.auditService.log({
      actorType: 'USER',
      actorId: actorUserId,
      organizationId,
      action: 'reddit_watch_topic.scan_requested',
      resource: `RedditWatchTopic:${id}`,
    });

    return this.triggerScan(organizationId, id);
  }

  // Best-effort: um scan disparado por aqui é um acelerador, não a única
  // forma do tópico ser verificado — o sweep diário do worker continua como
  // rede de segurança. Falha aqui (fila/Redis indisponível) nunca derruba
  // `create()`/`update()`/`runNow()`.
  private async triggerScan(organizationId: string, topicId: string): Promise<unknown> {
    try {
      return await this.scanQueueService.enqueue({ organizationId, topicId });
    } catch (error) {
      this.logger.warn(
        `Falha ao disparar scan imediato pro tópico ${topicId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  async remove(organizationId: string, id: string, actorUserId: string): Promise<void> {
    await this.findByIdOrThrow(organizationId, id);
    await this.prisma.redditWatchTopic.delete({ where: { id } });

    await this.auditService.log({
      actorType: 'USER',
      actorId: actorUserId,
      organizationId,
      action: 'reddit_watch_topic.deleted',
      resource: `RedditWatchTopic:${id}`,
    });
  }
}
