import type { OutreachMessage, PrismaClient } from '@opsmind/database';
import * as Sentry from '@sentry/node';
import { withTenantContext } from './tenant-context';

type OutreachFollowupCandidate = OutreachMessage & { lead: { name: string } };

/**
 * Lembrete de follow-up (plano pensando-como-empresa-com-agile-beaver.md) —
 * roda periodicamente (ver main.ts), achando `OutreachMessage` SENT há mais
 * de `thresholdDays` sem resposta e ainda não notificadas, e cria uma
 * notificação in-app pro usuário que aprovou o envio (`approvedByUserId`) —
 * quem decidiu enviar é quem faz mais sentido decidir se vale a pena
 * insistir. `followUpNotifiedAt` marca a mensagem como já notificada, pra
 * nunca duplicar o lembrete em ticks seguintes do scan.
 *
 * Diferente de `scanCustomerInactiveAutomations`/`scanProspectingTargets`
 * (trigger que só enfileira, processor separado que age): aqui a ação
 * (criar uma notificação) é uma única escrita local, sem chamada de rede
 * externa nem necessidade de retry via fila — mesmo racional de
 * `automation-processor.ts` usar uma transação (`withTenantContext`) para
 * notificação + dedup nunca ficarem dessincronizados, só que sem o passo
 * intermediário de fila (não há trabalho longo o bastante para justificar
 * um).
 */
export async function scanOutreachFollowups(prisma: PrismaClient, thresholdDays: number): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - thresholdDays);

  const candidates = (await prisma.outreachMessage.findMany({
    where: {
      status: 'SENT',
      sentAt: { lte: cutoff },
      repliedAt: null,
      followUpNotifiedAt: null,
      // Defensivo: `approve()` sempre exige um `userId` real, então isto
      // nunca deveria ser null na prática — mas `Notification.userId` não é
      // opcional, então nunca vale a pena arriscar.
      approvedByUserId: { not: null },
    },
    include: { lead: true },
  })) as OutreachFollowupCandidate[];

  let notifiedCount = 0;

  for (const message of candidates) {
    // Try/catch por mensagem — mesmo padrão de `scanProspectingTargets`: uma
    // falha isolada (ex.: erro transitório de banco) nunca aborta o resto do
    // scan, inclusive mensagens de outras organizações.
    try {
      await withTenantContext(prisma, message.organizationId, async (tx) => {
        await tx.notification.create({
          data: {
            organizationId: message.organizationId,
            userId: message.approvedByUserId!,
            type: 'outreach.followup_due',
            payload: { messageId: message.id, leadId: message.leadId, leadName: message.lead.name },
          },
        });
        await tx.outreachMessage.update({
          where: { id: message.id },
          data: { followUpNotifiedAt: new Date() },
        });
      });
      notifiedCount += 1;
    } catch (error) {
      Sentry.captureException(error, {
        extra: { outreachMessageId: message.id, organizationId: message.organizationId },
      });
    }
  }

  return notifiedCount;
}
