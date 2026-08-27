import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import type { Membership } from '@opsmind/database';
import type { Role } from '@opsmind/shared-types';
import { AiService, type ChatResult } from './ai.service';
import { BudgetService } from './services/budget.service';
import { ChatDto } from './dto/chat.dto';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { CurrentMembership } from '../../shared/decorators/current-membership.decorator';

export interface UsageResponse {
  monthSpend: number;
}

/**
 * Sem `@Roles()` — qualquer membro (até VIEWER) pode conversar com a IA e
 * pedir para ela ler dados (mesmo nível de acesso que ele já teria batendo
 * direto nos endpoints de leitura). A única ação de escrita disponível às
 * tools (create_task) tem seu próprio RBAC checado dentro do
 * `CreateTaskTool`, não aqui — ver comentário lá.
 */
@UseGuards(TenantGuard)
@Controller('organizations/:organizationId/ai')
export class AiController {
  constructor(
    private readonly aiService: AiService,
    private readonly budgetService: BudgetService,
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
  async usage(
    @Param('organizationId') organizationId: string,
    @CurrentMembership() _membership: Membership,
  ): Promise<UsageResponse> {
    const monthSpend = await this.budgetService.getMonthSpend(organizationId);
    return { monthSpend };
  }
}
