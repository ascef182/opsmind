import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { Roles } from '../../shared/decorators/roles.decorator';
import { RolesGuard } from '../../shared/guards/roles.guard';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { CreateContractDto, CreateContractFromDealDto, ListContractsQueryDto, UpdateContractDto } from './dto/contract.dto';
import {
  CreateEntryDto,
  IssueEntryDto,
  ListEntriesQueryDto,
  ReasonDto,
  RegisterPaymentDto,
  UpdateEntryDto,
} from './dto/entry.dto';
import { CreateRecurringDto, GenerateRecurringDto, UpdateRecurringDto } from './dto/recurring.dto';
import { OverviewQueryDto, ProfitabilityQueryDto, YearQueryDto } from './dto/report.dto';
import { FINANCE_READ_ROLE, FINANCE_WRITE_ROLE } from './finance.constants';
import { entriesToCsv } from './finance-csv';
import { FinanceContractsService } from './finance-contracts.service';
import { FinanceEntriesService } from './finance-entries.service';
import { FinanceRecurringService, type GenerateResult } from './finance-recurring.service';
import {
  FinanceReportsService,
  type AnnualReport,
  type FinanceOverview,
  type ProfitabilityReport,
} from './finance-reports.service';
import type { ContractView, FinancialEntryView, RecurringView } from './finance.types';

const EXPORT_LIMIT = 5000;

/**
 * Todas as rotas exigem papel MANAGER+ para ler e ADMIN+ para escrever
 * (finance.constants.ts) — acima do WRITE_ROLES do resto do CRM, porque
 * faturamento/dívida/lucro não são informação operacional de toda a equipe.
 * O `RolesGuard` roda depois do `TenantGuard` (que valida a organização).
 */
@UseGuards(TenantGuard, RolesGuard)
@Controller('organizations/:organizationId/finance')
export class FinanceController {
  constructor(
    private readonly entries: FinanceEntriesService,
    private readonly contracts: FinanceContractsService,
    private readonly recurring: FinanceRecurringService,
    private readonly reports: FinanceReportsService,
  ) {}

  // ── relatórios ─────────────────────────────────────────────────────────
  @Roles(FINANCE_READ_ROLE)
  @Get('overview')
  overview(@Param('organizationId') organizationId: string, @Query() query: OverviewQueryDto): Promise<FinanceOverview> {
    return this.reports.overview(organizationId, query);
  }

  @Roles(FINANCE_READ_ROLE)
  @Get('reports/annual')
  annual(@Param('organizationId') organizationId: string, @Query() query: YearQueryDto): Promise<AnnualReport> {
    return this.reports.annual(organizationId, query.year);
  }

  @Roles(FINANCE_READ_ROLE)
  @Get('reports/profitability')
  profitability(
    @Param('organizationId') organizationId: string,
    @Query() query: ProfitabilityQueryDto,
  ): Promise<ProfitabilityReport> {
    return this.reports.profitability(organizationId, query);
  }

  // ── lançamentos ────────────────────────────────────────────────────────
  @Roles(FINANCE_READ_ROLE)
  @Get('entries')
  listEntries(
    @Param('organizationId') organizationId: string,
    @Query() query: ListEntriesQueryDto,
  ): Promise<FinancialEntryView[]> {
    return this.entries.list(organizationId, query);
  }

  // Declarada antes de `entries/:entryId` para a rota literal não ser capturada pelo parâmetro.
  @Roles(FINANCE_READ_ROLE)
  @Get('entries/export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="lancamentos.csv"')
  async exportCsv(
    @Param('organizationId') organizationId: string,
    @Query() query: ListEntriesQueryDto,
  ): Promise<StreamableFile> {
    const rows = await this.entries.list(organizationId, { ...query, limit: EXPORT_LIMIT, offset: 0 });
    return new StreamableFile(Buffer.from(entriesToCsv(rows), 'utf-8'));
  }

  @Roles(FINANCE_READ_ROLE)
  @Get('entries/:entryId')
  getEntry(
    @Param('organizationId') organizationId: string,
    @Param('entryId', ParseUUIDPipe) entryId: string,
  ): Promise<FinancialEntryView> {
    return this.entries.findOne(organizationId, entryId);
  }

  @Roles(FINANCE_WRITE_ROLE)
  @Post('entries')
  createEntry(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: CreateEntryDto,
  ): Promise<FinancialEntryView> {
    return this.entries.create(organizationId, dto, { type: 'USER', id: user.id });
  }

  @Roles(FINANCE_WRITE_ROLE)
  @Patch('entries/:entryId')
  updateEntry(
    @Param('organizationId') organizationId: string,
    @Param('entryId', ParseUUIDPipe) entryId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: UpdateEntryDto,
  ): Promise<FinancialEntryView> {
    return this.entries.update(organizationId, entryId, dto, { type: 'USER', id: user.id });
  }

  @Roles(FINANCE_WRITE_ROLE)
  @Post('entries/:entryId/issue')
  issueEntry(
    @Param('organizationId') organizationId: string,
    @Param('entryId', ParseUUIDPipe) entryId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: IssueEntryDto,
  ): Promise<FinancialEntryView> {
    return this.entries.issue(organizationId, entryId, dto, { type: 'USER', id: user.id });
  }

  @Roles(FINANCE_WRITE_ROLE)
  @Post('entries/:entryId/cancel')
  cancelEntry(
    @Param('organizationId') organizationId: string,
    @Param('entryId', ParseUUIDPipe) entryId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: ReasonDto,
  ): Promise<FinancialEntryView> {
    return this.entries.cancel(organizationId, entryId, dto.reason, { type: 'USER', id: user.id });
  }

  @Roles(FINANCE_WRITE_ROLE)
  @Post('entries/:entryId/payments')
  registerPayment(
    @Param('organizationId') organizationId: string,
    @Param('entryId', ParseUUIDPipe) entryId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: RegisterPaymentDto,
  ): Promise<FinancialEntryView> {
    return this.entries.registerPayment(organizationId, entryId, dto, { type: 'USER', id: user.id });
  }

  @Roles(FINANCE_WRITE_ROLE)
  @Post('entries/:entryId/payments/:paymentId/reverse')
  reversePayment(
    @Param('organizationId') organizationId: string,
    @Param('entryId', ParseUUIDPipe) entryId: string,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: ReasonDto,
  ): Promise<FinancialEntryView> {
    return this.entries.reversePayment(organizationId, entryId, paymentId, dto.reason, { type: 'USER', id: user.id });
  }

  // ── contratos ──────────────────────────────────────────────────────────
  @Roles(FINANCE_READ_ROLE)
  @Get('contracts')
  listContracts(
    @Param('organizationId') organizationId: string,
    @Query() query: ListContractsQueryDto,
  ): Promise<ContractView[]> {
    return this.contracts.list(organizationId, query);
  }

  @Roles(FINANCE_READ_ROLE)
  @Get('contracts/:contractId')
  getContract(
    @Param('organizationId') organizationId: string,
    @Param('contractId', ParseUUIDPipe) contractId: string,
  ): Promise<ContractView> {
    return this.contracts.findOne(organizationId, contractId);
  }

  @Roles(FINANCE_WRITE_ROLE)
  @Post('contracts')
  createContract(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: CreateContractDto,
  ): Promise<ContractView> {
    return this.contracts.create(organizationId, dto, { type: 'USER', id: user.id });
  }

  @Roles(FINANCE_WRITE_ROLE)
  @Post('contracts/from-deal/:dealId')
  createContractFromDeal(
    @Param('organizationId') organizationId: string,
    @Param('dealId', ParseUUIDPipe) dealId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: CreateContractFromDealDto,
  ): Promise<{ contract: ContractView; tasksCreated: number }> {
    return this.contracts.createFromDeal(organizationId, dealId, dto, { type: 'USER', id: user.id });
  }

  @Roles(FINANCE_WRITE_ROLE)
  @Patch('contracts/:contractId')
  updateContract(
    @Param('organizationId') organizationId: string,
    @Param('contractId', ParseUUIDPipe) contractId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: UpdateContractDto,
  ): Promise<ContractView> {
    return this.contracts.update(organizationId, contractId, dto, { type: 'USER', id: user.id });
  }

  // ── recorrência ────────────────────────────────────────────────────────
  @Roles(FINANCE_READ_ROLE)
  @Get('recurring')
  listRecurring(@Param('organizationId') organizationId: string): Promise<RecurringView[]> {
    return this.recurring.list(organizationId);
  }

  @Roles(FINANCE_WRITE_ROLE)
  @Post('recurring')
  createRecurring(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: CreateRecurringDto,
  ): Promise<RecurringView> {
    return this.recurring.create(organizationId, dto, { type: 'USER', id: user.id });
  }

  @Roles(FINANCE_WRITE_ROLE)
  @Post('recurring/generate')
  generateRecurring(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: GenerateRecurringDto,
  ): Promise<GenerateResult> {
    return this.recurring.generate(organizationId, dto.upToMonth, { type: 'USER', id: user.id });
  }

  @Roles(FINANCE_WRITE_ROLE)
  @Patch('recurring/:recurringId')
  updateRecurring(
    @Param('organizationId') organizationId: string,
    @Param('recurringId', ParseUUIDPipe) recurringId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: UpdateRecurringDto,
  ): Promise<RecurringView> {
    return this.recurring.update(organizationId, recurringId, dto, { type: 'USER', id: user.id });
  }
}
