import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import type { OutreachStatus } from '@opsmind/database';

const OUTREACH_STATUSES: OutreachStatus[] = ['DRAFT', 'APPROVED', 'REJECTED', 'SENT', 'REPLIED'];

// Inbox compartilhada de outreach (GET .../outreach-messages) — mesma rota
// que já servia a fila de aprovação (?status=DRAFT), agora com dois filtros
// a mais, combináveis com `status` e entre si (Trilha B, plano
// pensando-como-empresa-com-agile-beaver.md).
export class ListOutreachMessagesQueryDto {
  @IsOptional()
  @IsIn(OUTREACH_STATUSES)
  status?: OutreachStatus;

  // "Não lidas" — leitura compartilhada de equipe, ver comentário de
  // `OutreachMessage.readAt` no schema.
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  unread?: boolean;

  // "Minhas" — filtra por Lead.assignedUserId (Trilha B/B1, roteamento).
  // Sempre o próprio usuário autenticado: o controller ignora qualquer
  // userId vindo daqui e usa `req.user.id`, nunca um valor arbitrário da
  // query (mesma defesa de qualquer campo sensível vindo de input externo).
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  mine?: boolean;
}
