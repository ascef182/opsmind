import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { RolesGuard } from '../../shared/guards/roles.guard';

// Global: todo módulo de domínio sensível (auth, organizations, memberships, ...)
// precisa registrar auditoria — evita reimportar AuditModule em cada um.
@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService, TenantGuard, RolesGuard],
  exports: [AuditService],
})
export class AuditModule {}
