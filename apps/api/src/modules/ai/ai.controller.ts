import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import type { Membership } from '@opsmind/database';
import type { Role } from '@opsmind/shared-types';
import { AiService, type ChatResult } from './ai.service';
import { AiUsageService, type RecentAiRequest, type UsageSummary } from './services/ai-usage.service';
import { ChatDto } from './dto/chat.dto';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { CurrentMembership } from '../../shared/decorators/current-membership.decorator';

/**
 * Sem `@Roles()` — qualquer membro (até VIEWER) pode conversar com a IA e
 * pedir para ela ler dados, e qualquer membro pode ver o painel de custo
 * (visibilidade, não mutação — configurar o orçamento é que exige papel,
 * ver OrganizationsController.update). A única ação de escrita disponível às
 * tools (create_task) tem seu próprio RBAC checado dentro do
 * `CreateTaskTool`, não aqui — ver comentário lá.
 */
@UseGuards(TenantGuard)
@Controller('organizations/:organizationId/ai')
export class AiController {
  constructor(
    private readonly aiService: AiService,
    private readonly aiUsageService: AiUsageService,
  ) {}

  @Post('chat')
  chat(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { id: string },
    @CurrentMembership() membership: Membership,
    @Body() dto: ChatDto,
  ): Promise<ChatResult> {
    return this.aiService.chat(
      { organizationId, userId: user.id, role: membership.role as Role },
      dto,
    );
  }

  @Get('usage')
  usage(@Param('organizationId') organizationId: string): Promise<UsageSummary> {
    return this.aiUsageService.getSummary(organizationId);
  }

  @Get('requests')
  recentRequests(@Param('organizationId') organizationId: string): Promise<RecentAiRequest[]> {
    return this.aiUsageService.listRecent(organizationId);
  }
}
