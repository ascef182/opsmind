import { Injectable, NotFoundException } from '@nestjs/common';
import type { RedditWatchTopic } from '@opsmind/database';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateRedditWatchTopicDto } from './dto/create-reddit-watch-topic.dto';
import { UpdateRedditWatchTopicDto } from './dto/update-reddit-watch-topic.dto';

export interface ListRedditWatchTopicsFilter {
  isActive?: boolean;
}

/**
 * CRUD simples de `RedditWatchTopic` — adaptado quase verbatim de
 * `ServiceOfferingsService` (`apps/api/src/modules/leads/service-offerings.
 * service.ts`): sem repository layer, `PrismaService` direto, audit log em
 * toda mutação. `apps/worker` é quem lê os tópicos ativos periodicamente
 * para buscar menções no Reddit e enfileirar clustering — este service só
 * cuida do CRUD que o humano opera.
 */
@Injectable()
export class RedditWatchTopicsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
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
    await this.findByIdOrThrow(organizationId, id);

    const updated = await this.prisma.redditWatchTopic.update({ where: { id }, data: dto });

    await this.auditService.log({
      actorType: 'USER',
      actorId: actorUserId,
      organizationId,
      action: 'reddit_watch_topic.updated',
      resource: `RedditWatchTopic:${id}`,
      metadata: { ...dto },
    });

    return updated;
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
