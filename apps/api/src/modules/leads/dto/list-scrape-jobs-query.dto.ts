import { IsIn, IsOptional } from 'class-validator';
import type { ScrapeJobStatus } from '@opsmind/database';

const SCRAPE_JOB_STATUSES: ScrapeJobStatus[] = ['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'];

// Antes disso o controller aceitava `?status=` como string crua direto no
// `where` do Prisma — um valor fora do enum batia em
// `PrismaClientValidationError` (500) em vez de um 400 limpo. Mesmo padrão
// de `ListLeadsQueryDto`/`ListOutreachMessagesQueryDto`.
export class ListScrapeJobsQueryDto {
  @IsOptional()
  @IsIn(SCRAPE_JOB_STATUSES)
  status?: ScrapeJobStatus;
}
