import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import type { Deal, DealSignatureRequest } from '@opsmind/database';
import { DealsService } from './deals.service';
import { DealProposalService } from './deal-proposal.service';
import { DealSignatureService } from './deal-signature.service';
import { CreateDealDto } from './dto/create-deal.dto';
import { UpdateDealDto } from './dto/update-deal.dto';
import { MoveDealStageDto } from './dto/move-deal-stage.dto';
import { ListDealsQueryDto } from './dto/list-deals-query.dto';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { RolesGuard } from '../../shared/guards/roles.guard';
import { Roles } from '../../shared/decorators/roles.decorator';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { WRITE_ROLES } from '../../shared/constants/roles.constant';

@UseGuards(TenantGuard)
@Controller('organizations/:organizationId/deals')
export class DealsController {
  constructor(
    private readonly dealsService: DealsService,
    private readonly dealProposalService: DealProposalService,
    private readonly dealSignatureService: DealSignatureService,
  ) {}

  @Roles(...WRITE_ROLES)
  @UseGuards(RolesGuard)
  @Post()
  create(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: CreateDealDto,
  ): Promise<Deal> {
    return this.dealsService.create(organizationId, dto, user.id);
  }

  @Get()
  list(
    @Param('organizationId') organizationId: string,
    @Query() query: ListDealsQueryDto,
  ): Promise<Deal[]> {
    return this.dealsService.list(organizationId, query);
  }

  @Get(':dealId')
  findOne(
    @Param('organizationId') organizationId: string,
    @Param('dealId') dealId: string,
  ): Promise<Deal> {
    return this.dealsService.findByIdOrThrow(organizationId, dealId);
  }

  @Roles(...WRITE_ROLES)
  @UseGuards(RolesGuard)
  @Patch(':dealId')
  update(
    @Param('organizationId') organizationId: string,
    @Param('dealId') dealId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: UpdateDealDto,
  ): Promise<Deal> {
    return this.dealsService.update(organizationId, dealId, dto, user.id);
  }

  @Roles(...WRITE_ROLES)
  @UseGuards(RolesGuard)
  @Post(':dealId/generate-proposal')
  generateProposal(
    @Param('organizationId') organizationId: string,
    @Param('dealId') dealId: string,
    @CurrentUser() user: { id: string },
  ): Promise<Deal> {
    return this.dealProposalService.generate(organizationId, dealId, user.id);
  }

  // Sem `@Roles` — leitura, mesmo padrão de `findOne`/`list` acima e de
  // `MeetingsController.downloadIcs`. `StreamableFile`, não um `Buffer` cru
  // — um `Buffer` devolvido direto do controller é tratado como objeto
  // JSON pelo Nest (`res.json({ type: 'Buffer', data: [...] })`), corrompendo
  // o PDF; `StreamableFile` é o jeito idiomático do Nest de sinalizar
  // "resposta binária", envia os bytes crus.
  @Get(':dealId/proposal.pdf')
  @Header('Content-Type', 'application/pdf')
  async downloadProposalPdf(
    @Param('organizationId') organizationId: string,
    @Param('dealId') dealId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const pdf = await this.dealProposalService.downloadPdf(organizationId, dealId);
    res.setHeader('Content-Disposition', `attachment; filename="proposta-${dealId}.pdf"`);
    return new StreamableFile(pdf);
  }

  @Roles(...WRITE_ROLES)
  @UseGuards(RolesGuard)
  @Post(':dealId/request-signature')
  requestSignature(
    @Param('organizationId') organizationId: string,
    @Param('dealId') dealId: string,
    @CurrentUser() user: { id: string },
  ): Promise<DealSignatureRequest> {
    return this.dealSignatureService.requestSignature(organizationId, dealId, user.id);
  }

  // Sem `@Roles` — leitura, mesmo padrão de `findOne`/`list` acima.
  @Get(':dealId/signature-requests')
  listSignatureRequests(
    @Param('organizationId') organizationId: string,
    @Param('dealId') dealId: string,
  ): Promise<DealSignatureRequest[]> {
    return this.dealSignatureService.list(organizationId, dealId);
  }

  @Roles(...WRITE_ROLES)
  @UseGuards(RolesGuard)
  @Post(':dealId/move-stage')
  moveStage(
    @Param('organizationId') organizationId: string,
    @Param('dealId') dealId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: MoveDealStageDto,
  ): Promise<Deal> {
    return this.dealsService.moveStage(organizationId, dealId, dto, user.id);
  }

  @Roles(...WRITE_ROLES)
  @UseGuards(RolesGuard)
  @HttpCode(204)
  @Delete(':dealId')
  async remove(
    @Param('organizationId') organizationId: string,
    @Param('dealId') dealId: string,
    @CurrentUser() user: { id: string },
  ): Promise<void> {
    await this.dealsService.remove(organizationId, dealId, user.id);
  }
}
