import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AutomationsService } from './automations.service';

describe('AutomationsService', () => {
  let service: AutomationsService;
  let prisma: {
    automation: { create: jest.Mock; findMany: jest.Mock; findFirst: jest.Mock };
    automationRun: { findMany: jest.Mock };
    organization: { findUniqueOrThrow: jest.Mock };
    customer: { findMany: jest.Mock };
  };
  let queueService: { enqueue: jest.Mock };
  let auditService: { log: jest.Mock };

  beforeEach(() => {
    prisma = {
      automation: { create: jest.fn(), findMany: jest.fn(), findFirst: jest.fn() },
      automationRun: { findMany: jest.fn() },
      organization: { findUniqueOrThrow: jest.fn() },
      customer: { findMany: jest.fn() },
    };
    queueService = { enqueue: jest.fn() };
    auditService = { log: jest.fn() };
    service = new AutomationsService(prisma as never, queueService as never, auditService as never);
  });

  describe('create', () => {
    it('cria a automação escopada à organização e audita', async () => {
      const created = { id: 'auto-1', organizationId: 'org-1', name: 'Cliente inativo' };
      prisma.automation.create.mockResolvedValue(created);

      const result = await service.create('org-1', 'user-1', {
        name: 'Cliente inativo',
        trigger: 'CUSTOMER_INACTIVE',
        actions: { createTask: true, notify: true },
      });

      expect(prisma.automation.create).toHaveBeenCalledWith({
        data: {
          organizationId: 'org-1',
          name: 'Cliente inativo',
          trigger: 'CUSTOMER_INACTIVE',
          conditions: {},
          actions: { createTask: true, notify: true },
          enabled: true,
        },
      });
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ actorType: 'USER', actorId: 'user-1', action: 'automation.created' }),
      );
      expect(result).toBe(created);
    });
  });

  describe('create — triggers de Deal', () => {
    it('cria uma automação com trigger DEAL_STAGE_STALE e persiste conditions/actions', async () => {
      prisma.automation.create.mockResolvedValue({ id: 'auto-1', trigger: 'DEAL_STAGE_STALE' });

      await service.create('org-1', 'user-1', {
        name: 'Negócio parado',
        trigger: 'DEAL_STAGE_STALE',
        conditions: { thresholdHoursOverride: 48 },
        actions: { createTask: true, notify: false },
      });

      expect(prisma.automation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          trigger: 'DEAL_STAGE_STALE',
          conditions: { thresholdHoursOverride: 48 },
          actions: { createTask: true, notify: false },
        }),
      });
    });

    it('cria uma automação com trigger DEAL_SILENT_FOR e persiste conditions/actions', async () => {
      prisma.automation.create.mockResolvedValue({ id: 'auto-2', trigger: 'DEAL_SILENT_FOR' });

      await service.create('org-1', 'user-1', {
        name: 'Cliente quieto',
        trigger: 'DEAL_SILENT_FOR',
        conditions: { silentForDays: 10 },
        actions: { createTask: true, notify: true },
      });

      expect(prisma.automation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ trigger: 'DEAL_SILENT_FOR', conditions: { silentForDays: 10 } }),
      });
    });
  });

  describe('findByIdOrThrow', () => {
    it('lança 404 quando a automação não existe ou é de outra organização', async () => {
      prisma.automation.findFirst.mockResolvedValue(null);

      await expect(service.findByIdOrThrow('org-1', 'missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('runNow', () => {
    it('enfileira uma execução (actorType USER) por cliente que qualifica agora, e devolve a contagem', async () => {
      prisma.automation.findFirst.mockResolvedValue({
        id: 'auto-1',
        organizationId: 'org-1',
        trigger: 'CUSTOMER_INACTIVE',
        enabled: true,
        conditions: {},
      });
      prisma.organization.findUniqueOrThrow.mockResolvedValue({ inactiveAfterDays: 14 });
      prisma.customer.findMany.mockResolvedValue([{ id: 'cust-1' }, { id: 'cust-2' }]);

      const result = await service.runNow('org-1', 'user-1', 'auto-1');

      expect(queueService.enqueue).toHaveBeenCalledTimes(2);
      expect(queueService.enqueue).toHaveBeenCalledWith({
        organizationId: 'org-1',
        automationId: 'auto-1',
        customerId: 'cust-1',
        actorType: 'USER',
        actorId: 'user-1',
      });
      expect(result).toEqual({ enqueued: 2 });
    });

    it('rejeita disparo manual de trigger que runNow não suporta (só CUSTOMER_INACTIVE nesta fase)', async () => {
      prisma.automation.findFirst.mockResolvedValue({
        id: 'auto-2',
        organizationId: 'org-1',
        trigger: 'DEAL_STAGE_STALE',
        enabled: true,
        conditions: {},
      });

      await expect(service.runNow('org-1', 'user-1', 'auto-2')).rejects.toThrow(BadRequestException);
      expect(prisma.customer.findMany).not.toHaveBeenCalled();
      expect(queueService.enqueue).not.toHaveBeenCalled();
    });

    it('rejeita disparo manual de automação desabilitada', async () => {
      prisma.automation.findFirst.mockResolvedValue({
        id: 'auto-1',
        organizationId: 'org-1',
        trigger: 'CUSTOMER_INACTIVE',
        enabled: false,
      });

      await expect(service.runNow('org-1', 'user-1', 'auto-1')).rejects.toThrow(BadRequestException);
      expect(queueService.enqueue).not.toHaveBeenCalled();
    });
  });

  describe('listRuns', () => {
    it('lista as execuções de uma automação, mais recentes primeiro', async () => {
      const runs = [{ id: 'run-1' }];
      prisma.automationRun.findMany.mockResolvedValue(runs);

      const result = await service.listRuns('org-1', 'auto-1');

      expect(prisma.automationRun.findMany).toHaveBeenCalledWith({
        where: { organizationId: 'org-1', automationId: 'auto-1' },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toBe(runs);
    });
  });
});
