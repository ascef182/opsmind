import { Global, Module } from '@nestjs/common';
import { PipelineHistoryService } from './pipeline-history.service';

// Global pelo mesmo motivo de `AuditModule`: leads, outreach e deals gravam
// histórico de estágio, e leads já importa deals (evita ciclo de módulos).
@Global()
@Module({
  providers: [PipelineHistoryService],
  exports: [PipelineHistoryService],
})
export class PipelineHistoryModule {}
