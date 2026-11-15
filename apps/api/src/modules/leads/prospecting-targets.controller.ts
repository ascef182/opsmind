import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { ProspectingTarget, ScrapeJob } from '@opsmind/database';
import { ProspectingTargetsService } from './prospecting-targets.service';
import { CreateProspectingTargetDto } from './dto/create-prospecting-target.dto';
import { UpdateProspectingTargetDto } from './dto/update-prospecting-target.dto';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { RolesGuard } from '../../shared/guards/roles.guard';
import { Roles } from '../../shared/decorators/roles.decorator';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { WRITE_ROLES } from '../../shared/constants/roles.constant';

@UseGuards(TenantGuard)
@Controller('organizations/:organizationId/prospecting-targets')
export class ProspectingTargetsController {
  constructor(private readonly prospectingTargetsService: ProspectingTargetsService) {}

  @Roles(...WRITE_ROLES)
  @UseGuards(RolesGuard)
  @Post()
  create(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: CreateProspectingTargetDto,
  ): Promise<ProspectingTarget> {
    return this.prospectingTargetsService.create(organizationId, dto, user.id);
  }

  @Get()
  list(
    @Param('organizationId') organizationId: string,
    @Query('isActive') isActive?: string,
  ): Promise<ProspectingTarget[]> {
    return this.prospectingTargetsService.list(organizationId, {
      isActive: isActive === undefined ? undefined : isActive === 'true',
    });
  }

  @Get(':targetId')
  findOne(
    @Param('organizationId') organizationId: string,
    @Param('targetId') targetId: string,
  ): Promise<ProspectingTarget> {
    return this.prospectingTargetsService.findByIdOrThrow(organizationId, targetId);
  }

  @Roles(...WRITE_ROLES)
  @UseGuards(RolesGuard)
  @Patch(':targetId')
  update(
    @Param('organizationId') organizationId: string,
    @Param('targetId') targetId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: UpdateProspectingTargetDto,
  ): Promise<ProspectingTarget> {
    return this.prospectingTargetsService.update(organizationId, targetId, dto, user.id);
  }

  // Dispara um ScrapeJob imediato pro alvo, ignorando cooldown — mesmo
  // padrão de escrita dos demais endpoints do controller.
  @Roles(...WRITE_ROLES)
  @UseGuards(RolesGuard)
  @Post(':targetId/scan-now')
  scanNow(
    @Param('organizationId') organizationId: string,
    @Param('targetId') targetId: string,
    @CurrentUser() user: { id: string },
  ): Promise<ScrapeJob | null> {
    return this.prospectingTargetsService.runNow(organizationId, targetId, user.id);
  }

  @Roles(...WRITE_ROLES)
  @UseGuards(RolesGuard)
  @HttpCode(204)
  @Delete(':targetId')
  async remove(
    @Param('organizationId') organizationId: string,
    @Param('targetId') targetId: string,
    @CurrentUser() user: { id: string },
  ): Promise<void> {
    await this.prospectingTargetsService.remove(organizationId, targetId, user.id);
  }
}
