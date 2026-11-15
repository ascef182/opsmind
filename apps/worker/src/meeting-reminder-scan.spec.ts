jest.mock('./tenant-context', () => ({
  withTenantContext: jest.fn((_prisma: unknown, _orgId: string, fn: (tx: unknown) => unknown) => fn('TX')),
}));
jest.mock('@sentry/node', () => ({ captureException: jest.fn() }));

import * as Sentry from '@sentry/node';
import { scanMeetingReminders } from './meeting-reminder-scan';

describe('scanMeetingReminders', () => {
  function buildPrisma() {
    return { meeting: { findMany: jest.fn() } };
  }

  function buildTx() {
    return {
      notification: { create: jest.fn().mockResolvedValue({ id: 'notif-1' }) },
      meeting: { update: jest.fn().mockResolvedValue({ id: 'meeting-1' }) },
    };
  }

  const upcomingMeeting = {
    id: 'meeting-1',
    organizationId: 'org-1',
    dealId: 'deal-1',
    title: 'Call de fechamento',
    scheduledAt: new Date('2026-10-01T15:00:00.000Z'),
    actorType: 'USER',
    actorId: 'user-creator',
    deal: { ownerUserId: 'user-owner', title: 'Contrato Acme' },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('busca reuniões não canceladas, sem lembrete ainda, dentro da janela de minutos configurada', async () => {
    const prisma = buildPrisma();
    prisma.meeting.findMany.mockResolvedValue([]);

    await scanMeetingReminders(prisma as never, 60);

    const call = prisma.meeting.findMany.mock.calls[0][0];
    expect(call.where.canceledAt).toBeNull();
    expect(call.where.reminderNotifiedAt).toBeNull();
    expect(call.where.scheduledAt.gte).toBeInstanceOf(Date);
    expect(call.where.scheduledAt.lte).toBeInstanceOf(Date);
    expect(call.include).toEqual({ deal: true });
  });

  it('notifica o dono do deal (prioridade sobre quem criou a reunião) e marca reminderNotifiedAt', async () => {
    const prisma = buildPrisma();
    const tx = buildTx();
    const { withTenantContext } = jest.requireMock('./tenant-context');
    withTenantContext.mockImplementation((_p: unknown, orgId: string, fn: (tx: unknown) => unknown) => {
      expect(orgId).toBe('org-1');
      return fn(tx);
    });
    prisma.meeting.findMany.mockResolvedValue([upcomingMeeting]);

    const count = await scanMeetingReminders(prisma as never, 60);

    expect(tx.notification.create).toHaveBeenCalledWith({
      data: {
        organizationId: 'org-1',
        userId: 'user-owner',
        type: 'meeting.reminder',
        payload: { meetingId: 'meeting-1', dealId: 'deal-1', title: 'Call de fechamento', dealTitle: 'Contrato Acme' },
      },
    });
    expect(tx.meeting.update).toHaveBeenCalledWith({
      where: { id: 'meeting-1' },
      data: { reminderNotifiedAt: expect.any(Date) },
    });
    expect(count).toBe(1);
  });

  it('sem dono do deal, cai pra quem criou a reunião (se for USER)', async () => {
    const prisma = buildPrisma();
    const tx = buildTx();
    const { withTenantContext } = jest.requireMock('./tenant-context');
    withTenantContext.mockImplementation((_p: unknown, _o: string, fn: (tx: unknown) => unknown) => fn(tx));
    prisma.meeting.findMany.mockResolvedValue([
      { ...upcomingMeeting, deal: { ownerUserId: null, title: 'Contrato Acme' } },
    ]);

    await scanMeetingReminders(prisma as never, 60);

    expect(tx.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 'user-creator' }) }),
    );
  });

  it('sem nenhum destinatário conhecido (dono nulo, ator SYSTEM), pula sem notificar', async () => {
    const prisma = buildPrisma();
    prisma.meeting.findMany.mockResolvedValue([
      { ...upcomingMeeting, actorType: 'SYSTEM', actorId: null, deal: { ownerUserId: null, title: 'Contrato Acme' } },
    ]);

    const count = await scanMeetingReminders(prisma as never, 60);

    expect(count).toBe(0);
  });

  it('uma falha isolada não aborta o scan — captura no Sentry e continua', async () => {
    const prisma = buildPrisma();
    const { withTenantContext } = jest.requireMock('./tenant-context');
    withTenantContext
      .mockImplementationOnce(() => {
        throw new Error('db error');
      })
      .mockImplementationOnce((_p: unknown, _o: string, fn: (tx: unknown) => unknown) => fn(buildTx()));
    prisma.meeting.findMany.mockResolvedValue([
      upcomingMeeting,
      { ...upcomingMeeting, id: 'meeting-2', organizationId: 'org-2' },
    ]);

    const count = await scanMeetingReminders(prisma as never, 60);

    expect(Sentry.captureException).toHaveBeenCalled();
    expect(count).toBe(1);
  });
});
