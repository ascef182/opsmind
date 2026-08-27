import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';

// Global: todo módulo de domínio sensível (auth, organizations, memberships, ...)
// precisa registrar auditoria — evita reimportar AuditModule em cada um.
// GET /audit-logs (P1 no blueprint) fica para o Passo 8, quando TenantGuard/
// RolesGuard existirem para protegê-lo.
@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
