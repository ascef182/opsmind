import { Injectable, NotFoundException } from '@nestjs/common';
import type { ScrapeJob, ScrapeJobStatus } from '@opsmind/database';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { LeadScrapeQueueService } from '../../infrastructure/queue/lead-scrape-queue.service';
import { CreateScrapeJobDto } from './dto/create-scrape-job.dto';

export interface ListScrapeJobsFilter {
  status?: ScrapeJobStatus;
}

/**
 * Sem repository layer — chama `PrismaService` diretamente. Enfileira via
 * `LeadScrapeQueueService` (produtor BullMQ da Task 4,
 * `apps/api/src/infrastructure/queue/lead-scrape-queue.service.ts`); quem
 * consome o job é `apps/worker/src/lead-scrape-processor.ts`, fora do
 * escopo desta task.
 *
 * `dto.sourceType` já é validado pelo `@IsIn` de `CreateScrapeJobDto` como
 * uma das 4 fontes automatizáveis (nunca `MANUAL`) — nada a revalidar aqui;
 * um payload com `sourceType: 'MANUAL'` já é rejeitado com 400 pelo
 * `ValidationPipe` global antes de chegar neste service.
 */
@Injectable()
export class ScrapeJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly leadScrapeQueueService: LeadScrapeQueueService,
  ) {}

  async create(
    organizationId: string,
    dto: CreateScrapeJobDto,
    actorUserId: string,
  ): Promise<ScrapeJob> {
    const job = await this.prisma.scrapeJob.create({
      data: {
        organizationId,
        sourceType: dto.sourceType,
        city: dto.city,
        state: dto.state,
        businessType: dto.businessType,
        onlyWithoutWebsite: dto.onlyWithoutWebsite ?? true,
        ...(dto.limit !== undefined ? { limit: dto.limit } : {}),
        status: 'QUEUED',
        actorType: 'USER',
        actorId: actorUserId,
      },
    });

    await this.leadScrapeQueueService.enqueue({
      organizationId,
      scrapeJobId: job.id,
      actorType: 'USER',
      actorId: actorUserId,
    });

    await this.auditService.log({
      actorType: 'USER',
      actorId: actorUserId,
      organizationId,
      action: 'scrape_job.created',
      resource: `ScrapeJob:${job.id}`,
      metadata: {
        sourceType: dto.sourceType,
        city: dto.city,
        state: dto.state,
        businessType: dto.businessType,
      },
    });

    return job;
  }

  async findByIdOrThrow(organizationId: string, id: string): Promise<ScrapeJob> {
    const job = await this.prisma.scrapeJob.findFirst({ where: { id, organizationId } });
    if (!job) {
      throw new NotFoundException('Scrape job não encontrado');
    }
    return job;
  }

  list(organizationId: string, filter: ListScrapeJobsFilter = {}): Promise<ScrapeJob[]> {
    return this.prisma.scrapeJob.findMany({
      where: {
        organizationId,
        ...(filter.status ? { status: filter.status } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
