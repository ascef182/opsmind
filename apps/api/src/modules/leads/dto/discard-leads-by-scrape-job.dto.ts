import { IsUUID } from 'class-validator';

export class DiscardLeadsByScrapeJobDto {
  @IsUUID()
  scrapeJobId!: string;
}
