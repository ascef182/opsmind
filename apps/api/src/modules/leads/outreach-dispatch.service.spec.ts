import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { EmailSendError } from '../../infrastructure/email/email.service';
import { OutreachDispatchService, RECONCILE_WINDOW_MS } from './outreach-dispatch.service';

const approved = {
  id: 'msg-1',
  organizationId: 'org-1',
  leadId: 'lead-1',
  channel: 'EMAIL',
  subject: 'Assunto',
  body: 'Corpo <b>',
  status: 'APPROVED',
  updatedAt: new Date('2026-11-18T10:00:00Z'),
};
const lead = {
  id: 'lead-1',
  name: 'Smile Dental',
  email: 'lead@example.com',
  campaignId: 'camp-1',
  unsubscribedAt: null as Date | null,
};

function build(opts: { agent?: 'ACTIVE' | 'PAUSED' | 'STOPPED'; message?: object; lead?: object } = {}) {
  const state = { message: { ...approved, ...opts.message } as Record<string, unknown> };
  const tx = {
    outreachMessage: {
      findFirst: jest.fn(async () => ({ ...state.message })),
      findFirstOrThrow: jest.fn(async () => ({ ...state.message })),
      updateMany: jest.fn(
        async ({ where, data }: { where: { status: string | { in: string[] } }; data: Record<string, unknown> }) => {
        const allowed = typeof where.status === 'string' ? [where.status] : where.status.in;
        if (!allowed.includes(state.message.status as string)) return { count: 0 };
        Object.assign(state.message, data);
        return { count: 1 };
      },
      ),
    },
    harveyAgent: { findUnique: jest.fn(async () => ({ controlState: opts.agent ?? 'ACTIVE' })) },
    lead: {
      findFirst: jest.fn(async ({ select }: { select: Record<string, boolean> }) =>
        select.status ? { status: 'OUTREACH_APPROVED' } : { ...lead, ...opts.lead },
      ),
      update: jest.fn(),
    },
    organization: { findFirst: jest.fn(async () => ({ outreachPhysicalAddress: 'Rua Exemplo, 123' })) },
    costEvent: { create: jest.fn() },
  };
  const prisma = { ...tx, runDetachedTenantTransaction: jest.fn((_org: string, fn: (t: typeof tx) => unknown) => fn(tx)) };
  const sender = {
    channel: 'EMAIL',
    providerName: 'resend',
    costPerMessageUsd: 0.0004,
    send: jest.fn().mockResolvedValue({ providerMessageId: 'resend-1' }),
  };
  const revenueSettings = {
    assertCanSendOutreach: jest.fn().mockResolvedValue(undefined),
    isGloballyPaused: jest.fn().mockReturnValue(false),
    get: jest.fn().mockResolvedValue({ outreachPaused: false }),
  };
  const warmup = { checkCanSend: jest.fn().mockResolvedValue({ blocked: false }), recordSent: jest.fn() };
  const pipelineHistory = { leadStatusChanged: jest.fn() };
  const audit = { log: jest.fn() };
  const recorder = { event: jest.fn() };
  const service = new OutreachDispatchService(
    prisma as never,
    [sender] as never,
    revenueSettings as never,
    warmup as never,
    pipelineHistory as never,
    audit as never,
    recorder as never,
  );
  return { service, state, sender, revenueSettings, warmup, pipelineHistory, recorder, tx };
}

const user = { type: 'USER' as const, userId: 'user-1' };

describe('OutreachDispatchService.dispatch', () => {
  it('sends once, records SENT with the provider id and a fixed idempotency key', async () => {
    const { service, state, sender, warmup, pipelineHistory, recorder } = build();
    const result = await service.dispatch('org-1', 'msg-1', user);

    expect(sender.send).toHaveBeenCalledTimes(1);
    const request = sender.send.mock.calls[0][0];
    expect(request).toMatchObject({ to: 'lead@example.com', subject: 'Assunto' });
    // Uma chave por reivindicação: a janela de reconciliação mede a idade desta chave.
    expect(request.idempotencyKey).toBe(
      `outreach-message/msg-1/${(state.message.sendClaimedAt as Date).getTime()}`,
    );
    expect(request.html).toContain('Corpo &lt;b&gt;');
    expect(request.html).toContain('Rua Exemplo, 123');
    expect(state.message.sendRequest).toEqual(request);
    expect(result).toMatchObject({ status: 'SENT', providerMessageId: 'resend-1' });
    expect(warmup.recordSent).toHaveBeenCalledTimes(1);
    expect(pipelineHistory.leadStatusChanged).toHaveBeenCalledWith('org-1', 'lead-1', 'OUTREACH_APPROVED', 'CONTACTED', {
      type: 'USER',
      id: 'user-1',
    });
    expect(recorder.event).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'outreach.sent', status: 'SUCCEEDED', actorType: 'USER' }),
    );
  });

  it('a second concurrent dispatch loses the claim and gets 409 without calling the provider', async () => {
    const { service, state, sender } = build();
    state.message.status = 'SENDING';
    await expect(service.dispatch('org-1', 'msg-1', user)).rejects.toBeInstanceOf(ConflictException);
    expect(sender.send).not.toHaveBeenCalled();
  });

  it('claims atomically: if another process claims between read and update, 409', async () => {
    const { service, tx, sender } = build();
    tx.outreachMessage.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.dispatch('org-1', 'msg-1', user)).rejects.toBeInstanceOf(ConflictException);
    expect(sender.send).not.toHaveBeenCalled();
  });

  it('a human send is never blocked by the Harvey state', async () => {
    const { service, sender, tx } = build({ agent: 'PAUSED' });
    await expect(service.dispatch('org-1', 'msg-1', user)).resolves.toMatchObject({ status: 'SENT' });
    expect(sender.send).toHaveBeenCalledTimes(1);
    expect(tx.harveyAgent.findUnique).not.toHaveBeenCalled();
  });

  it('send blocked when agent paused after claim (Harvey initiator)', async () => {
    const { service, state, sender, recorder } = build({ agent: 'PAUSED' });
    await expect(service.dispatch('org-1', 'msg-1', { type: 'HARVEY' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(sender.send).not.toHaveBeenCalled();
    expect(state.message.status).toBe('APPROVED');
    expect(recorder.event).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'outreach.send_blocked', status: 'SKIPPED' }),
    );
  });

  it('a guaranteed provider refusal reverts to APPROVED and keeps the error', async () => {
    const { service, state, sender } = build();
    sender.send.mockRejectedValueOnce(new EmailSendError('daily quota', 'daily_quota_exceeded', 'NOT_SENT'));
    await expect(service.dispatch('org-1', 'msg-1', user)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(state.message.status).toBe('APPROVED');
    expect(state.message.sendError).toContain('daily quota');
  });

  it('an ambiguous provider failure becomes SEND_UNKNOWN, never APPROVED', async () => {
    const { service, state, sender, recorder } = build();
    sender.send.mockRejectedValueOnce(new EmailSendError('socket hang up', null, 'UNKNOWN'));
    await expect(service.dispatch('org-1', 'msg-1', user)).rejects.toBeInstanceOf(BadGatewayException);
    expect(state.message.status).toBe('SEND_UNKNOWN');
    expect(recorder.event).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'outreach.send_uncertain', status: 'FAILED' }),
    );
  });

  it('an unexpected error type is treated as unknown too', async () => {
    const { service, state, sender } = build();
    sender.send.mockRejectedValueOnce(new Error('boom'));
    await expect(service.dispatch('org-1', 'msg-1', user)).rejects.toBeInstanceOf(BadGatewayException);
    expect(state.message.status).toBe('SEND_UNKNOWN');
  });

  it('keeps the organization release and daily limit checks before claiming', async () => {
    const { service, revenueSettings, state } = build();
    revenueSettings.assertCanSendOutreach.mockRejectedValueOnce(new ForbiddenException('pausado'));
    await expect(service.dispatch('org-1', 'msg-1', user)).rejects.toBeInstanceOf(ForbiddenException);
    expect(state.message.status).toBe('APPROVED');
  });

  it.each([
    ['lead without email', { lead: { email: null } }],
    ['unsubscribed lead', { lead: { unsubscribedAt: new Date() } }],
    ['channel without sender', { message: { channel: 'WHATSAPP' } }],
  ])('rejects %s with 400 before claiming', async (_label, opts) => {
    const { service, state, sender } = build(opts);
    await expect(service.dispatch('org-1', 'msg-1', user)).rejects.toBeInstanceOf(BadRequestException);
    expect(state.message.status).toBe('APPROVED');
    expect(sender.send).not.toHaveBeenCalled();
  });

  it('respects the email warmup block', async () => {
    const { service, warmup, sender } = build();
    warmup.checkCanSend.mockResolvedValueOnce({ blocked: true, reason: 'aquecendo' });
    await expect(service.dispatch('org-1', 'msg-1', user)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(sender.send).not.toHaveBeenCalled();
  });
});

describe('OutreachDispatchService.reconcile', () => {
  const claimedAt = new Date('2026-11-18T10:00:00Z');
  const storedRequest = { to: 'lead@example.com', subject: 'S', html: '<p>x</p>', idempotencyKey: 'outreach-message/msg-1' };
  const unknown = { status: 'SEND_UNKNOWN', sendClaimedAt: claimedAt, sendRequest: storedRequest, sendInitiator: 'USER' };

  it('replays the stored payload with the same key and confirms SENT', async () => {
    const { service, state, sender } = build({ message: unknown });
    await expect(service.reconcile('org-1', 'msg-1', new Date(claimedAt.getTime() + 15 * 60_000))).resolves.toBe('SENT');
    expect(sender.send).toHaveBeenCalledWith(storedRequest);
    expect(state.message.status).toBe('SENT');
  });

  it('never replays outside the idempotency window', async () => {
    const { service, state, sender } = build({ message: unknown });
    const late = new Date(claimedAt.getTime() + RECONCILE_WINDOW_MS + 1);
    await expect(service.reconcile('org-1', 'msg-1', late)).resolves.toBe('STILL_UNKNOWN');
    expect(sender.send).not.toHaveBeenCalled();
    expect(state.message.status).toBe('SEND_UNKNOWN');
  });

  it('does not replay when sending was paused for the organization in the meantime', async () => {
    const { service, revenueSettings, sender } = build({ message: unknown });
    revenueSettings.get.mockResolvedValueOnce({ outreachPaused: true });
    await expect(service.reconcile('org-1', 'msg-1', claimedAt)).resolves.toBe('STILL_UNKNOWN');
    expect(sender.send).not.toHaveBeenCalled();
  });

  it('does not replay a Harvey send while Harvey is paused', async () => {
    const { service, sender } = build({ message: { ...unknown, sendInitiator: 'HARVEY' }, agent: 'PAUSED' });
    await expect(service.reconcile('org-1', 'msg-1', claimedAt)).resolves.toBe('STILL_UNKNOWN');
    expect(sender.send).not.toHaveBeenCalled();
  });

  it('stays unknown when the provider reports an idempotency conflict', async () => {
    const { service, state, sender } = build({ message: unknown });
    sender.send.mockRejectedValueOnce(new EmailSendError('payload differs', 'invalid_idempotent_request', 'UNKNOWN'));
    await expect(service.reconcile('org-1', 'msg-1', claimedAt)).resolves.toBe('STILL_UNKNOWN');
    expect(state.message.status).toBe('SEND_UNKNOWN');
    expect(state.message.sendError).toContain('payload differs');
  });

  it('ignores messages that are not SEND_UNKNOWN', async () => {
    const { service, sender } = build();
    await expect(service.reconcile('org-1', 'msg-1')).resolves.toBe('NOT_APPLICABLE');
    expect(sender.send).not.toHaveBeenCalled();
  });
});

describe('OutreachDispatchService.resolveUnknown', () => {
  const unknown = { status: 'SEND_UNKNOWN', sendClaimedAt: new Date('2026-11-18T10:00:00Z') };

  it('NOT_SENT returns the message to APPROVED for a fresh send', async () => {
    const { service, state } = build({ message: unknown });
    await service.resolveUnknown('org-1', 'msg-1', 'NOT_SENT', 'user-1');
    expect(state.message).toMatchObject({ status: 'APPROVED', sendClaimedAt: null });
  });

  it('SENT confirms it and marks the lead contacted', async () => {
    const { service, state, pipelineHistory } = build({ message: unknown });
    await service.resolveUnknown('org-1', 'msg-1', 'SENT', 'user-1');
    expect(state.message.status).toBe('SENT');
    expect(pipelineHistory.leadStatusChanged).toHaveBeenCalled();
  });

  it('refuses when the message is not SEND_UNKNOWN', async () => {
    const { service } = build();
    await expect(service.resolveUnknown('org-1', 'msg-1', 'SENT', 'user-1')).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('OutreachDispatchService — races found in review', () => {
  it('a slow send already flagged SEND_UNKNOWN by the tick is confirmed as SENT, recorded once', async () => {
    const { service, state, sender, recorder } = build();
    sender.send.mockImplementationOnce(async () => {
      state.message.status = 'SEND_UNKNOWN';
      return { providerMessageId: 'resend-slow' };
    });
    await service.dispatch('org-1', 'msg-1', user);
    expect(state.message.status).toBe('SENT');
    expect(recorder.event).toHaveBeenCalledTimes(1);
  });

  it('reconcile claims the message before calling the provider, so a concurrent human decision cannot flip it', async () => {
    const claimedAt = new Date('2026-11-18T10:00:00Z');
    const { service, state, sender } = build({
      message: { status: 'SEND_UNKNOWN', sendClaimedAt: claimedAt, sendRequest: { to: 'x', subject: 's', html: 'h', idempotencyKey: 'k' } },
    });
    sender.send.mockImplementationOnce(async () => {
      expect(state.message.status).toBe('SENDING');
      await expect(service.resolveUnknown('org-1', 'msg-1', 'NOT_SENT', 'user-1')).rejects.toThrow();
      return { providerMessageId: 'resend-1' };
    });
    await expect(service.reconcile('org-1', 'msg-1', claimedAt)).resolves.toBe('SENT');
    expect(state.message.status).toBe('SENT');
  });

  it('when another process already confirmed the send, bookkeeping is not recorded again', async () => {
    const { service, state, sender, recorder, pipelineHistory } = build();
    sender.send.mockImplementationOnce(async () => {
      state.message.status = 'SENT';
      return { providerMessageId: 'resend-1' };
    });
    await service.dispatch('org-1', 'msg-1', user);
    expect(recorder.event).not.toHaveBeenCalled();
    expect(pipelineHistory.leadStatusChanged).not.toHaveBeenCalled();
  });
});
