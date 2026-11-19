jest.mock('./tenant-context', () => ({
  withTenantContext: jest.fn((_prisma: unknown, _orgId: string, fn: (tx: unknown) => unknown) => fn(currentTx)),
}));
jest.mock('@sentry/node', () => ({ captureException: jest.fn() }));

import * as Sentry from '@sentry/node';
import { withTenantContext } from './tenant-context';
import { scanComplianceReminders } from './opsgov-compliance-scan';

let currentTx: ReturnType<typeof buildTx>;

function buildTx(claimedCount = 1) {
  return {
    complianceReminder: { createMany: jest.fn().mockResolvedValue({ count: claimedCount }) },
    membership: { findMany: jest.fn().mockResolvedValue([{ userId: 'owner' }, { userId: 'admin' }]) },
    notification: { createMany: jest.fn().mockResolvedValue({ count: 2 }) },
  };
}

function buildPrisma(over: { obligations?: unknown[]; certificates?: unknown[]; superseded?: number } = {}) {
  return {
    complianceObligation: { findMany: jest.fn().mockResolvedValue(over.obligations ?? []) },
    certificate: {
      findMany: jest.fn().mockResolvedValue(over.certificates ?? []),
      count: jest.fn().mockResolvedValue(over.superseded ?? 0),
    },
  };
}

const das = { id: 'ob-1', organizationId: 'org-1', title: 'DAS', type: 'DAS', nextDueDate: new Date('2026-12-20') };
const cnd = { id: 'cert-1', organizationId: 'org-1', type: 'CND_FEDERAL', validUntil: new Date('2026-12-20') };

describe('scanComplianceReminders', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    currentTx = buildTx();
  });

  it('busca só obrigações pendentes até D-7 e certidões até D-15', async () => {
    const prisma = buildPrisma();
    await scanComplianceReminders(prisma as never, '2026-11-19');
    expect(prisma.complianceObligation.findMany.mock.calls[0][0].where).toEqual({
      status: 'PENDENTE',
      nextDueDate: { lte: new Date('2026-11-26') },
    });
    expect(prisma.certificate.findMany.mock.calls[0][0].where).toEqual({ validUntil: { lte: new Date('2026-12-04') } });
  });

  it('obrigação em D-1: grava o lembrete e notifica OWNER/ADMIN na mesma transação', async () => {
    const prisma = buildPrisma({ obligations: [das] });
    const notified = await scanComplianceReminders(prisma as never, '2026-12-19');

    expect(notified).toBe(2);
    expect(withTenantContext).toHaveBeenCalledWith(prisma, 'org-1', expect.any(Function));
    expect(currentTx.complianceReminder.createMany).toHaveBeenCalledWith({
      data: [{ organizationId: 'org-1', subjectType: 'OBLIGATION', subjectId: 'ob-1', dueDate: new Date('2026-12-20'), offsetDays: 1 }],
      skipDuplicates: true,
    });
    expect(currentTx.membership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: 'org-1', role: { in: ['OWNER', 'ADMIN'] } } }),
    );
    expect(currentTx.notification.createMany.mock.calls[0][0].data).toEqual([
      expect.objectContaining({ userId: 'owner', type: 'opsgov.obligation_due', payload: expect.objectContaining({ offsetDays: 1, daysLeft: 1 }) }),
      expect.objectContaining({ userId: 'admin' }),
    ]);
  });

  it('lembrete já registrado (segunda passada) não notifica de novo', async () => {
    currentTx = buildTx(0);
    const prisma = buildPrisma({ obligations: [das] });
    expect(await scanComplianceReminders(prisma as never, '2026-12-19')).toBe(0);
    expect(currentTx.notification.createMany).not.toHaveBeenCalled();
  });

  it('fora da janela de lembrete não cria nada', async () => {
    const prisma = buildPrisma({ obligations: [das] });
    expect(await scanComplianceReminders(prisma as never, '2026-12-10')).toBe(0);
    expect(withTenantContext).not.toHaveBeenCalled();
  });

  it('certidão em D-0 avisa; substituída por outra mais nova do mesmo tipo, não', async () => {
    const current = buildPrisma({ certificates: [cnd] });
    await scanComplianceReminders(current as never, '2026-12-20');
    expect(currentTx.complianceReminder.createMany.mock.calls[0][0].data[0]).toEqual(
      expect.objectContaining({ subjectType: 'CERTIFICATE', offsetDays: 0 }),
    );

    jest.clearAllMocks();
    const renewed = buildPrisma({ certificates: [cnd], superseded: 1 });
    expect(await scanComplianceReminders(renewed as never, '2026-12-20')).toBe(0);
    expect(withTenantContext).not.toHaveBeenCalled();
  });

  it('falha numa organização não interrompe as outras', async () => {
    (withTenantContext as jest.Mock)
      .mockImplementationOnce(() => Promise.reject(new Error('boom')))
      .mockImplementationOnce((_p: unknown, _o: string, fn: (tx: unknown) => unknown) => fn(currentTx));
    const prisma = buildPrisma({ obligations: [das, { ...das, id: 'ob-2', organizationId: 'org-2' }] });
    expect(await scanComplianceReminders(prisma as never, '2026-12-19')).toBe(2);
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });
});
