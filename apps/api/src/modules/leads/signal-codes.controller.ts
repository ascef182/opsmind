import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import type { SignalCode } from '@opsmind/database';
import { SignalCodesService } from './signal-codes.service';
import { CreateSignalCodeDto } from './dto/create-signal-code.dto';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { RolesGuard } from '../../shared/guards/roles.guard';
import { Roles } from '../../shared/decorators/roles.decorator';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { WRITE_ROLES } from '../../shared/constants/roles.constant';

// Governança de vocabulário — mais restrita que WRITE_ROLES comum, efeito dura em todo o scoring da organização.
const SIGNAL_CODE_GOVERNANCE_ROLE = 'MANAGER' as const;

@UseGuards(TenantGuard)
@Controller('organizations/:organizationId/signal-codes')
export class SignalCodesController {
  constructor(private readonly signalCodesService: SignalCodesService) {}

  @Get()
  list(@Param('organizationId') organizationId: string): Promise<SignalCode[]> {
    return this.signalCodesService.list(organizationId);
  }

  @Roles(...WRITE_ROLES)
  @UseGuards(RolesGuard)
  @Post()
  propose(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: CreateSignalCodeDto,
  ): Promise<SignalCode> {
    return this.signalCodesService.propose(organizationId, dto, user.id);
  }

  @Roles(SIGNAL_CODE_GOVERNANCE_ROLE)
  @UseGuards(RolesGuard)
  @HttpCode(200)
  @Post(':code/confirm')
  confirm(
    @Param('organizationId') organizationId: string,
    @Param('code') code: string,
    @CurrentUser() user: { id: string },
  ): Promise<SignalCode> {
    return this.signalCodesService.confirm(organizationId, code, user.id);
  }
}
