import { IsIn, IsOptional } from 'class-validator';
import type { OutreachStatus } from '@opsmind/database';

const OUTREACH_STATUSES: OutreachStatus[] = ['DRAFT', 'APPROVED', 'REJECTED', 'SENT', 'REPLIED'];

// Fila de revisão global (GET .../outreach-messages?status=DRAFT).
export class ListOutreachMessagesQueryDto {
  @IsOptional()
  @IsIn(OUTREACH_STATUSES)
  status?: OutreachStatus;
}
