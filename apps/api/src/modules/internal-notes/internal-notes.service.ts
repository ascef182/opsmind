import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
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
    // Achado de segurança (security-review, 2026-09-18): sem isto, `dealId`/
    // `leadId` vinha direto do `@Param()` do controller sem checar dono —
    // RLS só valida `internal_notes.organization_id` (a linha nova em si),
    // nunca a organização do Deal/Lead referenciado pela FK, então um
    // usuário desta organização conseguia anexar uma nota a um deal/lead de
    // OUTRA organização (oráculo de existência de UUID cross-tenant + FK
    // apontando pra fora do tenant). Não usa `DealsService`/`LeadsService`
    // (`findByIdOrThrow`) de propósito — criaria um ciclo de módulo
    // (`DealsModule`/`LeadsModule` já importam `InternalNotesModule`) — uma
    // checagem de existência direto no Prisma, escopada por
    // `organizationId`, resolve sem precisar dessas dependências. Sempre
    // 404 (nunca deixa vazar "existe mas é de outra org" via um erro
    // diferente, ex. violação de FK) — mesmo tipo de erro que um id
    // inexistente já produzia antes.
    if (target.dealId) {
      const deal = await this.prisma.deal.findFirst({
        where: { id: target.dealId, organizationId },
        select: { id: true },
      });
      if (!deal) {
        throw new NotFoundException('Deal não encontrado');
      }
    } else {
      const lead = await this.prisma.lead.findFirst({
        where: { id: target.leadId, organizationId },
        select: { id: true },
      });
      if (!lead) {
        throw new NotFoundException('Lead não encontrado');
      }
    }

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
