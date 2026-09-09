import { ProspectingTargetsController } from './prospecting-targets.controller';

describe('ProspectingTargetsController', () => {
  it('create: repassa organizationId, userId e dto para o service', async () => {
    const service = {
      create: jest.fn().mockResolvedValue({ id: 'target-1' }),
      list: jest.fn(),
      findByIdOrThrow: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
    };
    const controller = new ProspectingTargetsController(service as never);
    const dto = { city: 'São Paulo', state: 'SP', businessType: 'padaria' };

    const result = await controller.create('org-1', { id: 'user-1' } as never, dto as never);

    expect(result).toEqual({ id: 'target-1' });
    expect(service.create).toHaveBeenCalledWith('org-1', dto, 'user-1');
  });

  it('list: repassa isActive convertido de string pra boolean', async () => {
    const service = {
      create: jest.fn(),
      list: jest.fn().mockResolvedValue([]),
      findByIdOrThrow: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
    };
    const controller = new ProspectingTargetsController(service as never);

    await controller.list('org-1', 'true');

    expect(service.list).toHaveBeenCalledWith('org-1', { isActive: true });
  });

  it('list: isActive undefined quando query ausente', async () => {
    const service = {
      create: jest.fn(),
      list: jest.fn().mockResolvedValue([]),
      findByIdOrThrow: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
    };
    const controller = new ProspectingTargetsController(service as never);

    await controller.list('org-1', undefined);

    expect(service.list).toHaveBeenCalledWith('org-1', { isActive: undefined });
  });

  it('findOne: repassa organizationId e targetId para o service', async () => {
    const service = {
      create: jest.fn(),
      list: jest.fn(),
      findByIdOrThrow: jest.fn().mockResolvedValue({ id: 'target-1' }),
      update: jest.fn(),
      remove: jest.fn(),
    };
    const controller = new ProspectingTargetsController(service as never);

    const result = await controller.findOne('org-1', 'target-1');

    expect(result).toEqual({ id: 'target-1' });
    expect(service.findByIdOrThrow).toHaveBeenCalledWith('org-1', 'target-1');
  });

  it('update: repassa organizationId, targetId, userId e dto para o service', async () => {
    const service = {
      create: jest.fn(),
      list: jest.fn(),
      findByIdOrThrow: jest.fn(),
      update: jest.fn().mockResolvedValue({ id: 'target-1', isActive: false }),
      remove: jest.fn(),
    };
    const controller = new ProspectingTargetsController(service as never);
    const dto = { isActive: false };

    const result = await controller.update('org-1', 'target-1', { id: 'user-1' } as never, dto as never);

    expect(result).toEqual({ id: 'target-1', isActive: false });
    expect(service.update).toHaveBeenCalledWith('org-1', 'target-1', dto, 'user-1');
  });

  it('remove: repassa organizationId, targetId e userId para o service', async () => {
    const service = {
      create: jest.fn(),
      list: jest.fn(),
      findByIdOrThrow: jest.fn(),
      update: jest.fn(),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    const controller = new ProspectingTargetsController(service as never);

    await controller.remove('org-1', 'target-1', { id: 'user-1' } as never);

    expect(service.remove).toHaveBeenCalledWith('org-1', 'target-1', 'user-1');
  });
});
