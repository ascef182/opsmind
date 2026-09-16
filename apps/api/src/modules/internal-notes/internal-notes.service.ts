import { BadRequestException, Injectable } from '@nestjs/common';
import type { InternalNote } from '@opsmind/database';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

export interface CreateNoteInput {
  body: string;
  mentionedUserIds?: string[];
}

type NoteTarget = { dealId: string; leadId?: never } | { leadId: string; dealId?: never };

/**
 * Colaboração de equipe (plano pensando-como-empresa-com-agile-beaver.md,
 * trilha B — "parar de depender de Slack/WhatsApp pra time discutir um
 * negócio"). Menção por SELEÇÃO EXPLÍCITA de membros, não parsing de
 * "@nome" em texto livre (nomes reais têm espaço/acento/homônimos —
 * tornar a menção uma decisão explícita do autor é mais confiável do que
 * tentar adivinhar a partir do corpo do texto).
 */
@Injectable()
export class InternalNotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  createForDeal(
    organizationId: string,
    dealId: string,
    input: CreateNoteInput,
    authorUserId: string,
  ): Promise<InternalNote> {
    return this.create(organizationId, { dealId }, input, authorUserId);
  }

  createForLead(
    organizationId: string,
    leadId: string,
    input: CreateNoteInput,
    authorUserId: string,
  ): Promise<InternalNote> {
    return this.create(organizationId, { leadId }, input, authorUserId);
  }

  listForDeal(organizationId: string, dealId: string): Promise<InternalNote[]> {
    return this.prisma.internalNote.findMany({
      where: { organizationId, dealId },
      orderBy: { createdAt: 'desc' },
    });
  }

  listForLead(organizationId: string, leadId: string): Promise<InternalNote[]> {
    return this.prisma.internalNote.findMany({
      where: { organizationId, leadId },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async create(
    organizationId: string,
    target: NoteTarget,
    input: CreateNoteInput,
    authorUserId: string,
  ): Promise<InternalNote> {
    const mentionedUserIds = input.mentionedUserIds ?? [];

    if (mentionedUserIds.length > 0) {
      const validMembers = await this.prisma.membership.findMany({
        where: { organizationId, userId: { in: mentionedUserIds } },
        select: { userId: true },
      });
      if (validMembers.length !== new Set(mentionedUserIds).size) {
        throw new BadRequestException('Um ou mais usuários mencionados não são membros desta organização.');
      }
    }

    const note = await this.prisma.internalNote.create({
      data: {
        organizationId,
        ...target,
        body: input.body,
        mentionedUserIds,
        authorUserId,
      },
    });

    const payload = target.dealId
      ? { noteId: note.id, dealId: target.dealId }
      : { noteId: note.id, leadId: target.leadId };

    for (const userId of mentionedUserIds) {
      // Nunca notifica o próprio autor por ter se auto-mencionado.
      if (userId === authorUserId) {
        continue;
      }
      await this.notificationsService.create({
        organizationId,
        userId,
        type: 'note.mention',
        payload,
      });
    }

    return note;
  }
}
