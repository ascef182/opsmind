import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import type { ScrapeJob } from '@opsmind/database';
import { ScrapeJobsService } from './scrape-jobs.service';
import { CreateScrapeJobDto } from './dto/create-scrape-job.dto';
import { ListScrapeJobsQueryDto } from './dto/list-scrape-jobs-query.dto';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { RolesGuard } from '../../shared/guards/roles.guard';
import { Roles } from '../../shared/decorators/roles.decorator';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { WRITE_ROLES } from '../../shared/constants/roles.constant';

@UseGuards(TenantGuard)
@Controller('organizations/:organizationId/scrape-jobs')
export class ScrapeJobsController {
  constructor(private readonly scrapeJobsService: ScrapeJobsService) {}

  @Roles(...WRITE_ROLES)
  @UseGuards(RolesGuard)
  @Post()
  create(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: CreateScrapeJobDto,
  ): Promise<ScrapeJob> {
    return this.scrapeJobsService.create(organizationId, dto, user.id);
  }

  @Get()
  list(
    @Param('organizationId') organizationId: string,
    @Query() query: ListScrapeJobsQueryDto,
  ): Promise<ScrapeJob[]> {
    return this.scrapeJobsService.list(organizationId, query);
  }

  @Get(':scrapeJobId')
  findOne(
    @Param('organizationId') organizationId: string,
    @Param('scrapeJobId') scrapeJobId: string,
  ): Promise<ScrapeJob> {
    return this.scrapeJobsService.findByIdOrThrow(organizationId, scrapeJobId);
  }
}
