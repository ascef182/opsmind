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
  let scanQueueService: { enqueue: jest.Mock };

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
    scanQueueService = { enqueue: jest.fn().mockResolvedValue({ id: 'job-1' }) };
    service = new RedditWatchTopicsService(prisma as never, auditService as never, scanQueueService as never);
  });

  describe('create', () => {
    it('cria o tópico escopado à organização e audita', async () => {
      const created = { id: 'topic-1', organizationId: 'org-1', query: 'preciso de site', isActive: true };
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

    it('enfileira um scan imediato quando o tópico criado está ativo', async () => {
      prisma.redditWatchTopic.create.mockResolvedValue({ id: 'topic-1', organizationId: 'org-1', isActive: true });

      await service.create('org-1', { query: 'preciso de site' }, 'user-1');

      expect(scanQueueService.enqueue).toHaveBeenCalledWith({ organizationId: 'org-1', topicId: 'topic-1' });
    });

    it('não enfileira scan quando o tópico criado já nasce inativo', async () => {
      prisma.redditWatchTopic.create.mockResolvedValue({ id: 'topic-1', organizationId: 'org-1', isActive: false });

      await service.create('org-1', { query: 'preciso de site', isActive: false }, 'user-1');

      expect(scanQueueService.enqueue).not.toHaveBeenCalled();
    });

    it('não deixa uma falha ao enfileirar o scan derrubar a criação do tópico', async () => {
      const created = { id: 'topic-1', organizationId: 'org-1', isActive: true };
      prisma.redditWatchTopic.create.mockResolvedValue(created);
      scanQueueService.enqueue.mockRejectedValue(new Error('fila indisponível'));

      const result = await service.create('org-1', { query: 'preciso de site' }, 'user-1');

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

    it('enfileira um scan imediato quando isActive transiciona de false para true (reativação)', async () => {
      prisma.redditWatchTopic.findFirst.mockResolvedValue({ id: 'topic-1', organizationId: 'org-1', isActive: false });
      prisma.redditWatchTopic.update.mockResolvedValue({ id: 'topic-1', isActive: true });

      await service.update('org-1', 'topic-1', { isActive: true }, 'user-1');

      expect(scanQueueService.enqueue).toHaveBeenCalledWith({ organizationId: 'org-1', topicId: 'topic-1' });
    });

    it('não enfileira scan quando isActive já era true e continua true', async () => {
      prisma.redditWatchTopic.findFirst.mockResolvedValue({ id: 'topic-1', organizationId: 'org-1', isActive: true });
      prisma.redditWatchTopic.update.mockResolvedValue({ id: 'topic-1', isActive: true, query: 'novo' });

      await service.update('org-1', 'topic-1', { query: 'novo' }, 'user-1');

      expect(scanQueueService.enqueue).not.toHaveBeenCalled();
    });
  });

  describe('runNow', () => {
    it('enfileira um scan pro tópico existente, ignorando isActive', async () => {
      prisma.redditWatchTopic.findFirst.mockResolvedValue({ id: 'topic-1', organizationId: 'org-1', isActive: false });

      const result = await service.runNow('org-1', 'topic-1', 'user-1');

      expect(scanQueueService.enqueue).toHaveBeenCalledWith({ organizationId: 'org-1', topicId: 'topic-1' });
      expect(result).toEqual({ id: 'job-1' });
    });

    it('lança 404 quando o tópico não existe', async () => {
      prisma.redditWatchTopic.findFirst.mockResolvedValue(null);

      await expect(service.runNow('org-1', 'missing', 'user-1')).rejects.toThrow(NotFoundException);
    });

    it('retorna null (não lança) quando o enfileiramento falha', async () => {
      prisma.redditWatchTopic.findFirst.mockResolvedValue({ id: 'topic-1', organizationId: 'org-1', isActive: true });
      scanQueueService.enqueue.mockRejectedValue(new Error('fila indisponível'));

      await expect(service.runNow('org-1', 'topic-1', 'user-1')).resolves.toBeNull();
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
