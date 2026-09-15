jest.mock('./tenant-context', () => ({
  withTenantContext: jest.fn((_prisma: unknown, _orgId: string, fn: (tx: unknown) => unknown) => fn('TX')),
}));
jest.mock('@sentry/node', () => ({ captureException: jest.fn() }));

import * as Sentry from '@sentry/node';
import { scanOutreachFollowups } from './outreach-followup-scan';

describe('scanOutreachFollowups', () => {
  function buildPrisma() {
    return {
      outreachMessage: { findMany: jest.fn() },
    };
  }

  function buildTx() {
    return {
      notification: { create: jest.fn().mockResolvedValue({ id: 'notif-1' }) },
      outreachMessage: { update: jest.fn().mockResolvedValue({ id: 'msg-1' }) },
    };
  }

  const staleMessage = {
    id: 'msg-1',
    organizationId: 'org-1',
    leadId: 'lead-1',
    approvedByUserId: 'user-1',
    sentAt: new Date('2020-01-01'),
    lead: { name: 'Padaria Central' },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('busca SENT sem resposta, sem lembrete ainda e com aprovador conhecido, mais antigos que o threshold', async () => {
    const prisma = buildPrisma();
    prisma.outreachMessage.findMany.mockResolvedValue([]);

    await scanOutreachFollowups(prisma as never, 3);

    const call = prisma.outreachMessage.findMany.mock.calls[0][0];
    expect(call.where.status).toBe('SENT');
    expect(call.where.repliedAt).toBeNull();
    expect(call.where.followUpNotifiedAt).toBeNull();
    expect(call.where.approvedByUserId).toEqual({ not: null });
    expect(call.where.sentAt.lte).toBeInstanceOf(Date);
    expect(call.include).toEqual({ lead: true });
  });

  it('cria a notificação pro usuário que aprovou e marca followUpNotifiedAt, numa única transação com tenant context', async () => {
    const prisma = buildPrisma();
    const tx = buildTx();
    const { withTenantContext } = jest.requireMock('./tenant-context');
    withTenantContext.mockImplementation((_p: unknown, orgId: string, fn: (tx: unknown) => unknown) => {
      expect(orgId).toBe('org-1');
      return fn(tx);
    });
    prisma.outreachMessage.findMany.mockResolvedValue([staleMessage]);

    const count = await scanOutreachFollowups(prisma as never, 3);

    expect(tx.notification.create).toHaveBeenCalledWith({
      data: {
        organizationId: 'org-1',
        userId: 'user-1',
        type: 'outreach.followup_due',
        payload: { messageId: 'msg-1', leadId: 'lead-1', leadName: 'Padaria Central' },
      },
    });
    expect(tx.outreachMessage.update).toHaveBeenCalledWith({
      where: { id: 'msg-1' },
      data: { followUpNotifiedAt: expect.any(Date) },
    });
    expect(count).toBe(1);
  });

  it('uma falha isolada (ex.: erro na transação de um item) não aborta o scan — captura no Sentry e continua', async () => {
    const prisma = buildPrisma();
    const { withTenantContext } = jest.requireMock('./tenant-context');
    withTenantContext
      .mockImplementationOnce(() => {
        throw new Error('db error');
      })
      .mockImplementationOnce((_p: unknown, _o: string, fn: (tx: unknown) => unknown) => fn(buildTx()));
    prisma.outreachMessage.findMany.mockResolvedValue([
      staleMessage,
      { ...staleMessage, id: 'msg-2', organizationId: 'org-2' },
    ]);

    const count = await scanOutreachFollowups(prisma as never, 3);

    expect(Sentry.captureException).toHaveBeenCalled();
    expect(count).toBe(1);
  });
});
