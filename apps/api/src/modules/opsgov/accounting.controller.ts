import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { WRITE_ROLES } from '../../shared/constants/roles.constant';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { Roles } from '../../shared/decorators/roles.decorator';
import { RolesGuard } from '../../shared/guards/roles.guard';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { FINANCE_READ_ROLE } from '../finance/finance.constants';
import { AccountingService, type DecisionView, type ProposalView } from './accounting.service';
import { AddAnswerDto, CreateDecisionDto, CreateProposalDto, DecideDto, DecisionStatusDto, UpdateProposalDto } from './dto/accounting.dto';

// Propostas têm custo da empresa: leitura e escrita em MANAGER+ (subconjunto de
// WRITE_ROLES). Decisões: leitura para todo membro, escrita para WRITE_ROLES.
@UseGuards(TenantGuard, RolesGuard)
@Controller('organizations/:organizationId/opsgov/accounting')
export class AccountingController {
  constructor(private readonly accounting: AccountingService) {}

  @Roles(FINANCE_READ_ROLE)
  @Get('proposals')
  listProposals(@Param('organizationId') organizationId: string): Promise<ProposalView[]> {
    return this.accounting.listProposals(organizationId);
  }

  @Roles(FINANCE_READ_ROLE)
  @Post('proposals')
  createProposal(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: CreateProposalDto,
  ): Promise<ProposalView> {
    return this.accounting.createProposal(organizationId, dto, { type: 'USER', id: user.id });
  }

  @Roles(FINANCE_READ_ROLE)
  @Patch('proposals/:proposalId')
  updateProposal(
    @Param('organizationId') organizationId: string,
    @Param('proposalId', ParseUUIDPipe) proposalId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: UpdateProposalDto,
  ): Promise<ProposalView> {
    return this.accounting.updateProposal(organizationId, proposalId, dto, { type: 'USER', id: user.id });
  }

  @Roles(FINANCE_READ_ROLE)
  @Delete('proposals/:proposalId')
  @HttpCode(204)
  deleteProposal(
    @Param('organizationId') organizationId: string,
    @Param('proposalId', ParseUUIDPipe) proposalId: string,
    @CurrentUser() user: { id: string },
  ): Promise<void> {
    return this.accounting.deleteProposal(organizationId, proposalId, { type: 'USER', id: user.id });
  }

  @Get('decisions')
  listDecisions(@Param('organizationId') organizationId: string): Promise<DecisionView[]> {
    return this.accounting.listDecisions(organizationId);
  }

  @Roles(...WRITE_ROLES)
  @Post('decisions/defaults')
  loadDefaults(@Param('organizationId') organizationId: string, @CurrentUser() user: { id: string }): Promise<{ created: number }> {
    return this.accounting.loadDefaultDecisions(organizationId, { type: 'USER', id: user.id });
  }

  @Roles(...WRITE_ROLES)
  @Post('decisions')
  createDecision(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: CreateDecisionDto,
  ): Promise<DecisionView> {
    return this.accounting.createDecision(organizationId, dto, { type: 'USER', id: user.id });
  }

  @Roles(...WRITE_ROLES)
  @Post('decisions/:decisionId/answers')
  addAnswer(
    @Param('organizationId') organizationId: string,
    @Param('decisionId', ParseUUIDPipe) decisionId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: AddAnswerDto,
  ): Promise<DecisionView> {
    return this.accounting.addAnswer(organizationId, decisionId, dto, { type: 'USER', id: user.id });
  }

  @Roles(...WRITE_ROLES)
  @Post('decisions/:decisionId/decide')
  decide(
    @Param('organizationId') organizationId: string,
    @Param('decisionId', ParseUUIDPipe) decisionId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: DecideDto,
  ): Promise<DecisionView> {
    return this.accounting.decide(organizationId, decisionId, dto, { type: 'USER', id: user.id });
  }

  @Roles(...WRITE_ROLES)
  @Post('decisions/:decisionId/status')
  setStatus(
    @Param('organizationId') organizationId: string,
    @Param('decisionId', ParseUUIDPipe) decisionId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: DecisionStatusDto,
  ): Promise<DecisionView> {
    return this.accounting.setStatus(organizationId, decisionId, dto, { type: 'USER', id: user.id });
  }
}
