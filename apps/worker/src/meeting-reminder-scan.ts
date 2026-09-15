import type { Meeting, PrismaClient } from '@opsmind/database';
import * as Sentry from '@sentry/node';
import { withTenantContext } from './tenant-context';

type MeetingReminderCandidate = Meeting & { deal: { ownerUserId: string | null; title: string } };

/**
 * Lembrete de reunião (plano pensando-como-empresa-com-agile-beaver.md,
 * fechando o item "lembretes e agenda" do roadmap) — roda periodicamente
 * (ver main.ts, mesmo intervalo fixo de `scanTaskDueReminders`), achando
 * `Meeting` não canceladas cujo horário cai dentro dos próximos
 * `minutesBefore` minutos e ainda não notificadas, e cria uma notificação
 * in-app pro dono do `Deal` vinculado — na ausência de um dono, cai pra quem
 * criou a reunião (`actorId`, só quando `actorType === 'USER'`; uma reunião
 * criada por SYSTEM/AI sem dono de deal não tem pra quem notificar).
 * `reminderNotifiedAt` marca a reunião como já notificada, mesmo racional de
 * `Task.dueDateNotifiedAt`/`OutreachMessage.followUpNotifiedAt`.
 */
export async function scanMeetingReminders(prisma: PrismaClient, minutesBefore: number): Promise<number> {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + minutesBefore * 60_000);

  const candidates = (await prisma.meeting.findMany({
    where: {
      canceledAt: null,
      reminderNotifiedAt: null,
      scheduledAt: { gte: now, lte: windowEnd },
    },
    include: { deal: true },
  })) as MeetingReminderCandidate[];

  let notifiedCount = 0;

  for (const meeting of candidates) {
    const recipientUserId = meeting.deal.ownerUserId ?? (meeting.actorType === 'USER' ? meeting.actorId : null);
    if (!recipientUserId) {
      continue;
    }

    // Try/catch por reunião — mesmo padrão de `scanOutreachFollowups`/
    // `scanTaskDueReminders`: uma falha isolada nunca aborta o resto do
    // scan, inclusive reuniões de outras organizações.
    try {
      await withTenantContext(prisma, meeting.organizationId, async (tx) => {
        await tx.notification.create({
          data: {
            organizationId: meeting.organizationId,
            userId: recipientUserId,
            type: 'meeting.reminder',
            payload: {
              meetingId: meeting.id,
              dealId: meeting.dealId,
              title: meeting.title,
              dealTitle: meeting.deal.title,
            },
          },
        });
        await tx.meeting.update({
          where: { id: meeting.id },
          data: { reminderNotifiedAt: new Date() },
        });
      });
      notifiedCount += 1;
    } catch (error) {
      Sentry.captureException(error, {
        extra: { meetingId: meeting.id, organizationId: meeting.organizationId },
      });
    }
  }

  return notifiedCount;
}
