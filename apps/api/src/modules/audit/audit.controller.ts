import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import type { AuditLog } from '@opsmind/database';
import { AuditService } from './audit.service';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { RolesGuard } from '../../shared/guards/roles.guard';
import { Roles } from '../../shared/decorators/roles.decorator';

// Rota nascida no Passo 9 (docs/planning/sprint-1-2-plan.md §4), não mais no
// Passo 6 original: dependia de TenantGuard/RolesGuard, que só passaram a
// existir no Passo 8. Nested sob a organização (não `GET /audit-logs` solto)
// para se encaixar no padrão de escopo do TenantGuard.
@UseGuards(TenantGuard, RolesGuard)
@Roles('ADMIN')
@Controller('organizations/:organizationId/audit-logs')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  list(@Param('organizationId') organizationId: string): Promise<AuditLog[]> {
    return this.auditService.listForOrganization(organizationId);
  }
}
