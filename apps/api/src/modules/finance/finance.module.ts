import { Module } from '@nestjs/common';
import { TasksModule } from '../tasks/tasks.module';
import { RolesGuard } from '../../shared/guards/roles.guard';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { FinanceContractsService } from './finance-contracts.service';
import { FinanceEntriesService } from './finance-entries.service';
import { FinanceRecurringService } from './finance-recurring.service';
import { FinanceReportsService } from './finance-reports.service';
import { FinanceController } from './finance.controller';

@Module({
  imports: [TasksModule],
  controllers: [FinanceController],
  providers: [
    FinanceEntriesService,
    FinanceContractsService,
    FinanceRecurringService,
    FinanceReportsService,
    TenantGuard,
    RolesGuard,
  ],
  // Exportado para a AI tool de leitura e para o resumo executivo do dashboard.
  exports: [FinanceReportsService, FinanceEntriesService],
})
export class FinanceModule {}
