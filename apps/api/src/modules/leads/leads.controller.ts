import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import type { Customer, InternalNote, Lead, LeadEnrichment } from '@opsmind/database';
import { LeadsService } from './leads.service';
import { LeadAnalysisService } from './lead-analysis.service';
import { InternalNotesService } from '../internal-notes/internal-notes.service';
import { CreateNoteDto } from '../internal-notes/dto/create-note.dto';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { ListLeadsQueryDto } from './dto/list-leads-query.dto';
import { ConvertLeadDto } from './dto/convert-lead.dto';
import { AssignLeadDto } from './dto/assign-lead.dto';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { RolesGuard } from '../../shared/guards/roles.guard';
import { Roles } from '../../shared/decorators/roles.decorator';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { WRITE_ROLES } from '../../shared/constants/roles.constant';

@UseGuards(TenantGuard)
@Controller('organizations/:organizationId/leads')
export class LeadsController {
  constructor(
    private readonly leadsService: LeadsService,
    private readonly leadAnalysisService: LeadAnalysisService,
    private readonly internalNotesService: InternalNotesService,
  ) {}

  @Roles(...WRITE_ROLES)
  @UseGuards(RolesGuard)
  @Post()
  create(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: CreateLeadDto,
  ): Promise<Lead> {
    return this.leadsService.create(organizationId, dto, user.id);
  }

  @Get()
  list(
    @Param('organizationId') organizationId: string,
    @Query() query: ListLeadsQueryDto,
  ): Promise<Lead[]> {
    return this.leadsService.list(organizationId, query);
  }

  @Get(':leadId')
  findOne(
    @Param('organizationId') organizationId: string,
    @Param('leadId') leadId: string,
  ): Promise<Lead> {
    return this.leadsService.findByIdOrThrow(organizationId, leadId);
  }

  @Roles(...WRITE_ROLES)
  @UseGuards(RolesGuard)
  @Patch(':leadId')
  update(
    @Param('organizationId') organizationId: string,
    @Param('leadId') leadId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: UpdateLeadDto,
  ): Promise<Lead> {
    return this.leadsService.update(organizationId, leadId, dto, user.id);
  }

  @Roles(...WRITE_ROLES)
  @UseGuards(RolesGuard)
  @Post(':leadId/score')
  score(
    @Param('organizationId') organizationId: string,
    @Param('leadId') leadId: string,
    @CurrentUser() user: { id: string },
  ): Promise<Lead> {
    return this.leadsService.score(organizationId, leadId, user.id);
  }

  @Roles(...WRITE_ROLES)
  @UseGuards(RolesGuard)
  @Post(':leadId/unsubscribe')
  unsubscribe(
    @Param('organizationId') organizationId: string,
    @Param('leadId') leadId: string,
    @CurrentUser() user: { id: string },
  ): Promise<Lead> {
    return this.leadsService.unsubscribe(organizationId, leadId, user.id);
  }

  @Roles(...WRITE_ROLES)
  @UseGuards(RolesGuard)
  @Post(':leadId/enrich')
  enrich(
    @Param('organizationId') organizationId: string,
    @Param('leadId') leadId: string,
    @CurrentUser() user: { id: string },
  ): Promise<Lead> {
    return this.leadsService.enrich(organizationId, leadId, user.id);
  }

  @Roles(...WRITE_ROLES)
  @UseGuards(RolesGuard)
  @Post(':leadId/analyze')
  analyze(
    @Param('organizationId') organizationId: string,
    @Param('leadId') leadId: string,
    @CurrentUser() user: { id: string },
  ): Promise<LeadEnrichment> {
    return this.leadAnalysisService.analyzeLeadPotential(organizationId, leadId, user.id);
  }

  @Roles(...WRITE_ROLES)
  @UseGuards(RolesGuard)
  @Post(':leadId/assign')
  assign(
    @Param('organizationId') organizationId: string,
    @Param('leadId') leadId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: AssignLeadDto,
  ): Promise<Lead> {
    return this.leadsService.assign(organizationId, leadId, dto.userId, user.id);
  }

  // Colaboração de equipe (Trilha B) — notas internas, nunca vistas por
  // outreach nem por uma AI tool.
  @Roles(...WRITE_ROLES)
  @UseGuards(RolesGuard)
  @Post(':leadId/notes')
  addNote(
    @Param('organizationId') organizationId: string,
    @Param('leadId') leadId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: CreateNoteDto,
  ): Promise<InternalNote> {
    return this.internalNotesService.createForLead(organizationId, leadId, dto, user.id);
  }

  @Get(':leadId/notes')
  listNotes(
    @Param('organizationId') organizationId: string,
    @Param('leadId') leadId: string,
  ): Promise<InternalNote[]> {
    return this.internalNotesService.listForLead(organizationId, leadId);
  }

  @Roles(...WRITE_ROLES)
  @UseGuards(RolesGuard)
  @Post(':leadId/convert')
  convert(
    @Param('organizationId') organizationId: string,
    @Param('leadId') leadId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: ConvertLeadDto,
  ): Promise<Customer> {
    return this.leadsService.convertToCustomer(organizationId, leadId, dto, user.id);
  }
}
