import { SignalCodesController } from './signal-codes.controller';

describe('SignalCodesController', () => {
  function buildService() {
    return { list: jest.fn(), propose: jest.fn(), confirm: jest.fn() };
  }

  it('list: repassa organizationId pro service', async () => {
    const service = buildService();
    service.list.mockResolvedValue([{ code: 'NO_WEBSITE' }]);
    const controller = new SignalCodesController(service as never);

    const result = await controller.list('org-1');

    expect(result).toEqual([{ code: 'NO_WEBSITE' }]);
    expect(service.list).toHaveBeenCalledWith('org-1');
  });

  it('propose: repassa organizationId, dto e userId pro service', async () => {
    const service = buildService();
    service.propose.mockResolvedValue({ code: 'NEW_CODE', status: 'PROPOSED' });
    const controller = new SignalCodesController(service as never);
    const dto = { code: 'NEW_CODE', label: 'Novo código', category: 'tecnologia' };

    const result = await controller.propose('org-1', { id: 'user-1' } as never, dto as never);

    expect(result).toEqual({ code: 'NEW_CODE', status: 'PROPOSED' });
    expect(service.propose).toHaveBeenCalledWith('org-1', dto, 'user-1');
  });

  it('confirm: repassa organizationId, code e userId pro service', async () => {
    const service = buildService();
    service.confirm.mockResolvedValue({ code: 'NEW_CODE', status: 'CONFIRMED' });
    const controller = new SignalCodesController(service as never);

    const result = await controller.confirm('org-1', 'NEW_CODE', { id: 'user-1' } as never);

    expect(result).toEqual({ code: 'NEW_CODE', status: 'CONFIRMED' });
    expect(service.confirm).toHaveBeenCalledWith('org-1', 'NEW_CODE', 'user-1');
  });
});
