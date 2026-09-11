import { RedditWatchTopicsController } from './reddit-watch-topics.controller';

describe('RedditWatchTopicsController', () => {
  let controller: RedditWatchTopicsController;
  let service: {
    create: jest.Mock;
    list: jest.Mock;
    findByIdOrThrow: jest.Mock;
    update: jest.Mock;
    remove: jest.Mock;
  };

  beforeEach(() => {
    service = {
      create: jest.fn(),
      list: jest.fn(),
      findByIdOrThrow: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
    };
    controller = new RedditWatchTopicsController(service as never);
  });

  it('create delega ao service com o userId do chamador', async () => {
    service.create.mockResolvedValue({ id: 'topic-1' });

    const result = await controller.create('org-1', { id: 'user-1' }, { query: 'preciso de site' });

    expect(service.create).toHaveBeenCalledWith('org-1', { query: 'preciso de site' }, 'user-1');
    expect(result).toEqual({ id: 'topic-1' });
  });

  it('list converte isActive de string para boolean', async () => {
    service.list.mockResolvedValue([]);

    await controller.list('org-1', 'true');

    expect(service.list).toHaveBeenCalledWith('org-1', { isActive: true });
  });

  it('list passa isActive undefined quando query ausente', async () => {
    service.list.mockResolvedValue([]);

    await controller.list('org-1');

    expect(service.list).toHaveBeenCalledWith('org-1', { isActive: undefined });
  });

  it('findOne delega ao service', async () => {
    service.findByIdOrThrow.mockResolvedValue({ id: 'topic-1' });

    const result = await controller.findOne('org-1', 'topic-1');

    expect(service.findByIdOrThrow).toHaveBeenCalledWith('org-1', 'topic-1');
    expect(result).toEqual({ id: 'topic-1' });
  });

  it('update delega ao service com o userId do chamador', async () => {
    service.update.mockResolvedValue({ id: 'topic-1', isActive: false });

    await controller.update('org-1', 'topic-1', { id: 'user-1' }, { isActive: false });

    expect(service.update).toHaveBeenCalledWith('org-1', 'topic-1', { isActive: false }, 'user-1');
  });

  it('remove delega ao service com o userId do chamador', async () => {
    await controller.remove('org-1', 'topic-1', { id: 'user-1' });

    expect(service.remove).toHaveBeenCalledWith('org-1', 'topic-1', 'user-1');
  });
});
