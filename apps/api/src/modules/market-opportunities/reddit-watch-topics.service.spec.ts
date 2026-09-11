import { NotFoundException } from '@nestjs/common';
import { RedditWatchTopicsService } from './reddit-watch-topics.service';

describe('RedditWatchTopicsService', () => {
  let service: RedditWatchTopicsService;
  let prisma: {
    redditWatchTopic: {
      create: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
  };
  let auditService: { log: jest.Mock };

  beforeEach(() => {
    prisma = {
      redditWatchTopic: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };
    auditService = { log: jest.fn() };
    service = new RedditWatchTopicsService(prisma as never, auditService as never);
  });

  describe('create', () => {
    it('cria o tópico escopado à organização e audita', async () => {
      const created = { id: 'topic-1', organizationId: 'org-1', query: 'preciso de site' };
      prisma.redditWatchTopic.create.mockResolvedValue(created);

      const result = await service.create(
        'org-1',
        { query: 'preciso de site', subreddit: 'smallbusiness' },
        'user-1',
      );

      expect(prisma.redditWatchTopic.create).toHaveBeenCalledWith({
        data: { organizationId: 'org-1', query: 'preciso de site', subreddit: 'smallbusiness' },
      });
      expect(auditService.log).toHaveBeenCalledWith({
        actorType: 'USER',
        actorId: 'user-1',
        organizationId: 'org-1',
        action: 'reddit_watch_topic.created',
        resource: 'RedditWatchTopic:topic-1',
      });
      expect(result).toBe(created);
    });
  });

  describe('findByIdOrThrow', () => {
    it('lança 404 quando o tópico não existe ou não pertence à org', async () => {
      prisma.redditWatchTopic.findFirst.mockResolvedValue(null);

      await expect(service.findByIdOrThrow('org-1', 'missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('list', () => {
    it('filtra por isActive quando informado', async () => {
      prisma.redditWatchTopic.findMany.mockResolvedValue([]);

      await service.list('org-1', { isActive: true });

      expect(prisma.redditWatchTopic.findMany).toHaveBeenCalledWith({
        where: { organizationId: 'org-1', isActive: true },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('não filtra por isActive quando omitido', async () => {
      prisma.redditWatchTopic.findMany.mockResolvedValue([]);

      await service.list('org-1');

      expect(prisma.redditWatchTopic.findMany).toHaveBeenCalledWith({
        where: { organizationId: 'org-1' },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('update', () => {
    it('atualiza e audita', async () => {
      prisma.redditWatchTopic.findFirst.mockResolvedValue({ id: 'topic-1', organizationId: 'org-1' });
      const updated = { id: 'topic-1', isActive: false };
      prisma.redditWatchTopic.update.mockResolvedValue(updated);

      const result = await service.update('org-1', 'topic-1', { isActive: false }, 'user-1');

      expect(prisma.redditWatchTopic.update).toHaveBeenCalledWith({
        where: { id: 'topic-1' },
        data: { isActive: false },
      });
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'reddit_watch_topic.updated', resource: 'RedditWatchTopic:topic-1' }),
      );
      expect(result).toBe(updated);
    });

    it('lança 404 quando o tópico não existe antes de tentar atualizar', async () => {
      prisma.redditWatchTopic.findFirst.mockResolvedValue(null);

      await expect(service.update('org-1', 'missing', { isActive: false }, 'user-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.redditWatchTopic.update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('remove e audita', async () => {
      prisma.redditWatchTopic.findFirst.mockResolvedValue({ id: 'topic-1', organizationId: 'org-1' });

      await service.remove('org-1', 'topic-1', 'user-1');

      expect(prisma.redditWatchTopic.delete).toHaveBeenCalledWith({ where: { id: 'topic-1' } });
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'reddit_watch_topic.deleted', resource: 'RedditWatchTopic:topic-1' }),
      );
    });
  });
});
