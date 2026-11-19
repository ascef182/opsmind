import type { PrismaClient } from '@opsmind/database';
import * as Sentry from '@sentry/node';
import {
  CERTIFICATE_REMINDER_OFFSETS,
  OBLIGATION_REMINDER_OFFSETS,
  addDays,
  daysBetween,
  fromDateKey,
  reminderOffsetDue,
  toDateKey,
  todayInSaoPaulo,
} from '@opsmind/shared-types';
import { withTenantContext } from './tenant-context';

// Quem recebe os lembretes de obrigação/certidão: quem responde pela empresa.
const REMINDER_ROLES = ['OWNER', 'ADMIN'] as const;

interface Reminder {
  organizationId: string;
  subjectType: 'OBLIGATION' | 'CERTIFICATE';
  subjectId: string;
  dueDate: string;
  offsetDays: number;
  notificationType: string;
  payload: Record<string, unknown>;
}

/**
 * Lembretes do OpsGov (Fase 4): obrigações pendentes em D-7/D-1 e certidões
 * em D-15/D-0 viram Notification para OWNER/ADMIN. Ação local, sem rede —
 * direto no scan, como `scanTaskDueReminders`.
 *
 * Idempotência: `ComplianceReminder` (UNIQUE subject+vencimento+offset) é
 * gravado na MESMA transação das notificações; se já existia, nada é criado.
 * Vale entre réplicas e reinícios do worker. Só o offset mais urgente já
 * alcançado é enviado (`reminderOffsetDue`), então um scan atrasado não manda
 * rajada. Certidão substituída por outra mais nova do mesmo tipo não avisa.
 */
export async function scanComplianceReminders(prisma: PrismaClient, today: string = todayInSaoPaulo()): Promise<number> {
  const maxObligationOffset = Math.max(...OBLIGATION_REMINDER_OFFSETS);
  const maxCertificateOffset = Math.max(...CERTIFICATE_REMINDER_OFFSETS);

  const [obligations, certificates] = await Promise.all([
    prisma.complianceObligation.findMany({
      where: { status: 'PENDENTE', nextDueDate: { lte: fromDateKey(addDays(today, maxObligationOffset)) } },
      select: { id: true, organizationId: true, title: true, type: true, nextDueDate: true },
    }),
    prisma.certificate.findMany({
      where: { validUntil: { lte: fromDateKey(addDays(today, maxCertificateOffset)) } },
      select: { id: true, organizationId: true, type: true, validUntil: true },
    }),
  ]);

  const reminders: Reminder[] = [];
  for (const o of obligations) {
    const dueDate = toDateKey(o.nextDueDate);
    const offsetDays = reminderOffsetDue(dueDate, today, OBLIGATION_REMINDER_OFFSETS);
    if (offsetDays === null) continue;
    reminders.push({
      organizationId: o.organizationId,
      subjectType: 'OBLIGATION',
      subjectId: o.id,
      dueDate,
      offsetDays,
      notificationType: 'opsgov.obligation_due',
      payload: { obligationId: o.id, title: o.title, obligationType: o.type, dueDate, offsetDays, daysLeft: daysBetween(today, dueDate) },
    });
  }

  for (const c of certificates) {
    const validUntil = toDateKey(c.validUntil);
    const offsetDays = reminderOffsetDue(validUntil, today, CERTIFICATE_REMINDER_OFFSETS);
    if (offsetDays === null) continue;
    const superseded = await prisma.certificate.count({
      where: { organizationId: c.organizationId, type: c.type, validUntil: { gt: c.validUntil } },
    });
    if (superseded > 0) continue;
    reminders.push({
      organizationId: c.organizationId,
      subjectType: 'CERTIFICATE',
      subjectId: c.id,
      dueDate: validUntil,
      offsetDays,
      notificationType: 'opsgov.certificate_expiring',
      payload: { certificateId: c.id, certificateType: c.type, validUntil, offsetDays, daysLeft: daysBetween(today, validUntil) },
    });
  }

  let notified = 0;
  for (const reminder of reminders) {
    // Uma falha isolada nunca aborta o resto do scan (outras organizações).
    try {
      notified += await withTenantContext(prisma, reminder.organizationId, async (tx) => {
        const claimed = await tx.complianceReminder.createMany({
          data: [
            {
              organizationId: reminder.organizationId,
              subjectType: reminder.subjectType,
              subjectId: reminder.subjectId,
              dueDate: fromDateKey(reminder.dueDate),
              offsetDays: reminder.offsetDays,
            },
          ],
          skipDuplicates: true,
        });
        if (claimed.count === 0) return 0;

        const admins = await tx.membership.findMany({
          where: { organizationId: reminder.organizationId, role: { in: [...REMINDER_ROLES] } },
          select: { userId: true },
        });
        if (admins.length === 0) return 0;
        await tx.notification.createMany({
          data: admins.map((admin) => ({
            organizationId: reminder.organizationId,
            userId: admin.userId,
            type: reminder.notificationType,
            payload: reminder.payload as never,
          })),
        });
        return admins.length;
      });
    } catch (error) {
      Sentry.captureException(error, { extra: { subjectType: reminder.subjectType, subjectId: reminder.subjectId } });
    }
  }
  return notified;
}
