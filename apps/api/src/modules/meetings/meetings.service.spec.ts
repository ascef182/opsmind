import { NotFoundException } from '@nestjs/common';
import { MeetingsService } from './meetings.service';

describe('MeetingsService', () => {
  let service: MeetingsService;
  let prisma: {
    deal: { findFirst: jest.Mock };
    meeting: { create: jest.Mock; findFirst: jest.Mock; findMany: jest.Mock; update: jest.Mock };
  };
  let auditService: { log: jest.Mock };

  beforeEach(() => {
    prisma = {
      deal: { findFirst: jest.fn() },
      meeting: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
    };
    auditService = { log: jest.fn().mockResolvedValue(undefined) };
    service = new MeetingsService(prisma as never, auditService as never);
  });

  describe('create', () => {
    it('rejeita quando o deal não pertence à organização (ou não existe)', async () => {
      prisma.deal.findFirst.mockResolvedValue(null);

      await expect(
        service.create('org-1', 'deal-1', { title: 'Call', scheduledAt: new Date() }, 'user-1'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.meeting.create).not.toHaveBeenCalled();
    });

    it('cria a reunião vinculada ao deal, com duração default 30min, e audita', async () => {
      prisma.deal.findFirst.mockResolvedValue({ id: 'deal-1', organizationId: 'org-1', deletedAt: null });
      const created = { id: 'meeting-1', dealId: 'deal-1', title: 'Call' };
      prisma.meeting.create.mockResolvedValue(created);
      const scheduledAt = new Date('2026-10-01T14:00:00.000Z');

      const result = await service.create('org-1', 'deal-1', { title: 'Call', scheduledAt }, 'user-1');

      expect(prisma.meeting.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: 'org-1',
          dealId: 'deal-1',
          title: 'Call',
          scheduledAt,
          durationMinutes: 30,
          actorType: 'USER',
          actorId: 'user-1',
        }),
      });
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'meeting.created', resource: 'Meeting:meeting-1' }),
      );
      expect(result).toBe(created);
    });
  });

  describe('findByIdOrThrow', () => {
    it('lança 404 quando a reunião não existe/não pertence à org', async () => {
      prisma.meeting.findFirst.mockResolvedValue(null);

      await expect(service.findByIdOrThrow('org-1', 'missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('list', () => {
    it('lista reuniões de um deal, mais próximas primeiro', async () => {
      const meetings = [{ id: 'meeting-1' }];
      prisma.meeting.findMany.mockResolvedValue(meetings);

      const result = await service.list('org-1', 'deal-1');

      expect(prisma.meeting.findMany).toHaveBeenCalledWith({
        where: { organizationId: 'org-1', dealId: 'deal-1' },
        orderBy: { scheduledAt: 'asc' },
      });
      expect(result).toBe(meetings);
    });
  });

  describe('update', () => {
    it('ao mudar scheduledAt, limpa reminderNotifiedAt (novo horário merece novo lembrete)', async () => {
      prisma.meeting.findFirst.mockResolvedValue({
        id: 'meeting-1',
        organizationId: 'org-1',
        scheduledAt: new Date('2026-10-01T14:00:00.000Z'),
        reminderNotifiedAt: new Date('2026-10-01T13:00:00.000Z'),
      });
      const newScheduledAt = new Date('2026-10-02T14:00:00.000Z');
      prisma.meeting.update.mockResolvedValue({ id: 'meeting-1', scheduledAt: newScheduledAt });

      await service.update('org-1', 'meeting-1', { scheduledAt: newScheduledAt }, 'user-1');

      expect(prisma.meeting.update).toHaveBeenCalledWith({
        where: { id: 'meeting-1' },
        data: { scheduledAt: newScheduledAt, reminderNotifiedAt: null },
      });
    });

    it('não mexe em reminderNotifiedAt quando scheduledAt não muda', async () => {
      prisma.meeting.findFirst.mockResolvedValue({
        id: 'meeting-1',
        organizationId: 'org-1',
        scheduledAt: new Date('2026-10-01T14:00:00.000Z'),
        reminderNotifiedAt: null,
      });
      prisma.meeting.update.mockResolvedValue({ id: 'meeting-1', title: 'Novo título' });

      await service.update('org-1', 'meeting-1', { title: 'Novo título' }, 'user-1');

      expect(prisma.meeting.update).toHaveBeenCalledWith({
        where: { id: 'meeting-1' },
        data: { title: 'Novo título' },
      });
    });
  });

  describe('cancel', () => {
    it('seta canceledAt e audita', async () => {
      prisma.meeting.findFirst.mockResolvedValue({ id: 'meeting-1', organizationId: 'org-1' });
      prisma.meeting.update.mockResolvedValue({ id: 'meeting-1', canceledAt: new Date() });

      await service.cancel('org-1', 'meeting-1', 'user-1');

      expect(prisma.meeting.update).toHaveBeenCalledWith({
        where: { id: 'meeting-1' },
        data: { canceledAt: expect.any(Date) },
      });
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'meeting.canceled', resource: 'Meeting:meeting-1' }),
      );
    });
  });
});
