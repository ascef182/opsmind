import { Global, Module } from '@nestjs/common';
import { PipelineHistoryService } from './pipeline-history.service';
import { RevenueSettingsService } from './revenue-settings.service';

// Global pelo mesmo motivo de `AuditModule`: leads, outreach e deals gravam
// histórico de estágio e consultam a pausa de outreach, e leads já importa
// deals (evita ciclo de módulos).
@Global()
@Module({
  providers: [PipelineHistoryService, RevenueSettingsService],
  exports: [PipelineHistoryService, RevenueSettingsService],
})
export class RevenueCoreModule {}
