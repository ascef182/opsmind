import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import type { OutreachMessage } from '@opsmind/database';
import { OutreachService, type OutreachMessageWithLead } from './outreach.service';
import { GenerateOutreachDto } from './dto/generate-outreach.dto';
import { RejectOutreachDto } from './dto/reject-outreach.dto';
import { EditOutreachDto } from './dto/edit-outreach.dto';
import { ListOutreachMessagesQueryDto } from './dto/list-outreach-messages-query.dto';
import { ResolveUnknownSendDto } from './dto/resolve-unknown-send.dto';
import { OutreachDispatchService } from './outreach-dispatch.service';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { RolesGuard } from '../../shared/guards/roles.guard';
import { Roles } from '../../shared/decorators/roles.decorator';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { WRITE_ROLES } from '../../shared/constants/roles.constant';
import { TransactionTimeout } from '../../shared/decorators/transaction-timeout.decorator';

// Gerar um rascunho pode fazer até 3 versões com revisão de qualidade cada
// (6 chamadas de IA); o padrão de 10s da transação da request não cabe.
const OUTREACH_DRAFT_TRANSACTION_TIMEOUT_MS = 90_000;

/**
 * Todas as transições de estado (approve/reject/regenerate/mark-sent/
 * mark-replied) exigem `@Roles(...WRITE_ROLES)` + `RolesGuard` — o mesmo
 * humano autenticado que passou pelo `JwtAuthGuard` global. Não existe (nem
 * pode existir) uma rota equivalente chamável pela IA — ver o comentário de
 * topo de `outreach.service.ts`.
 */
@UseGuards(TenantGuard)
@Controller('organizations/:organizationId')
export class OutreachMessagesController {
  constructor(
    private readonly outreachService: OutreachService,
    private readonly dispatchService: OutreachDispatchService,
  ) {}

  @Roles(...WRITE_ROLES)
  @UseGuards(RolesGuard)
  @TransactionTimeout(OUTREACH_DRAFT_TRANSACTION_TIMEOUT_MS)
  @Post('leads/:leadId/outreach-messages')
  generateDraft(
    @Param('organizationId') organizationId: string,
    @Param('leadId') leadId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: GenerateOutreachDto,
  ): Promise<OutreachMessage> {
    return this.outreachService.generateDraft(organizationId, leadId, dto, { type: 'USER', userId: user.id });
  }

  @Get('leads/:leadId/outreach-messages')
  listForLead(
    @Param('organizationId') organizationId: string,
    @Param('leadId') leadId: string,
  ): Promise<OutreachMessage[]> {
    return this.outreachService.listForLead(organizationId, leadId);
  }

  // Inbox compartilhada de outreach (Trilha B) — ?status=DRAFT continua
  // servindo a fila de aprovação de sempre; ?status=SENT/REPLIED (ou sem
  // status) mais ?unread=true/?mine=true cobrem a visão de equipe.
  // `mine` sempre resolve pro próprio usuário autenticado (`user.id`),
  // nunca um valor arbitrário — ver comentário do DTO.
  @Get('outreach-messages')
  list(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { id: string },
    @Query() query: ListOutreachMessagesQueryDto,
  ): Promise<OutreachMessageWithLead[]> {
    return this.outreachService.list(organizationId, {
      status: query.status,
      unreadOnly: query.unread,
      assignedToUserId: query.mine ? user.id : undefined,
    });
  }

  // Leitura COMPARTILHADA de equipe, não uma transição de status — mesmo
  // racional de `edit` (PATCH) não ser um dos POST .../<verbo> de transição
  // reais abaixo. `@Roles` pelo mesmo motivo de toda outra mutação deste
  // controller: consistência, não porque marcar como lida seja arriscado.
  @Roles(...WRITE_ROLES)
  @UseGuards(RolesGuard)
  @Post('outreach-messages/:messageId/mark-read')
  markRead(
    @Param('organizationId') organizationId: string,
    @Param('messageId') messageId: string,
    @CurrentUser() user: { id: string },
  ): Promise<OutreachMessage> {
    return this.outreachService.markRead(organizationId, messageId, user.id);
  }

  @Get('outreach-messages/:messageId')
  findOne(
    @Param('organizationId') organizationId: string,
    @Param('messageId') messageId: string,
  ): Promise<OutreachMessage> {
    return this.outreachService.findByIdOrThrow(organizationId, messageId);
  }

  // Edita body/subject de um rascunho ainda em DRAFT (Task 15) — não é uma
  // transição de estado (status continua DRAFT), por isso PATCH em vez de
  // um dos POST .../<verbo> usados pelas transições reais abaixo.
  @Roles(...WRITE_ROLES)
  @UseGuards(RolesGuard)
  @Patch('outreach-messages/:messageId')
  edit(
    @Param('organizationId') organizationId: string,
    @Param('messageId') messageId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: EditOutreachDto,
  ): Promise<OutreachMessage> {
    return this.outreachService.edit(organizationId, messageId, dto, user.id);
  }

  @Roles(...WRITE_ROLES)
  @UseGuards(RolesGuard)
  @Post('outreach-messages/:messageId/approve')
  approve(
    @Param('organizationId') organizationId: string,
    @Param('messageId') messageId: string,
    @CurrentUser() user: { id: string },
  ): Promise<OutreachMessage> {
    return this.outreachService.approve(organizationId, messageId, user.id);
  }

  @Roles(...WRITE_ROLES)
  @UseGuards(RolesGuard)
  @Post('outreach-messages/:messageId/reject')
  reject(
    @Param('organizationId') organizationId: string,
    @Param('messageId') messageId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: RejectOutreachDto,
  ): Promise<OutreachMessage> {
    return this.outreachService.reject(organizationId, messageId, dto, user.id);
  }

  @Roles(...WRITE_ROLES)
  @UseGuards(RolesGuard)
  @TransactionTimeout(OUTREACH_DRAFT_TRANSACTION_TIMEOUT_MS)
  @Post('outreach-messages/:messageId/regenerate')
  regenerate(
    @Param('organizationId') organizationId: string,
    @Param('messageId') messageId: string,
    @CurrentUser() user: { id: string },
  ): Promise<OutreachMessage> {
    return this.outreachService.regenerate(organizationId, messageId, user.id);
  }

  // Envio real feito por uma pessoa (ver `OutreachDispatchService`). Não
  // depende do estado do Harvey; continua sem contraparte de AI tool.
  @Roles(...WRITE_ROLES)
  @UseGuards(RolesGuard)
  @TransactionTimeout(60_000)
  @Post('outreach-messages/:messageId/send')
  send(
    @Param('organizationId') organizationId: string,
    @Param('messageId') messageId: string,
    @CurrentUser() user: { id: string },
  ): Promise<OutreachMessage> {
    return this.dispatchService.dispatch(organizationId, messageId, { type: 'USER', userId: user.id });
  }

  // Envio sem confirmação do provedor (SEND_UNKNOWN): a pessoa verificou no
  // provedor e informa se saiu ou não.
  @Roles(...WRITE_ROLES)
  @UseGuards(RolesGuard)
  @Post('outreach-messages/:messageId/resolve-unknown')
  resolveUnknown(
    @Param('organizationId') organizationId: string,
    @Param('messageId') messageId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: ResolveUnknownSendDto,
  ): Promise<OutreachMessage> {
    return this.dispatchService.resolveUnknown(organizationId, messageId, dto.outcome, user.id);
  }

  @Roles(...WRITE_ROLES)
  @UseGuards(RolesGuard)
  @Post('outreach-messages/:messageId/mark-sent')
  markSent(
    @Param('organizationId') organizationId: string,
    @Param('messageId') messageId: string,
    @CurrentUser() user: { id: string },
  ): Promise<OutreachMessage> {
    return this.outreachService.markSent(organizationId, messageId, user.id);
  }

  @Roles(...WRITE_ROLES)
  @UseGuards(RolesGuard)
  @Post('outreach-messages/:messageId/mark-replied')
  markReplied(
    @Param('organizationId') organizationId: string,
    @Param('messageId') messageId: string,
    @CurrentUser() user: { id: string },
  ): Promise<OutreachMessage> {
    return this.outreachService.markReplied(organizationId, messageId, user.id);
  }
}
