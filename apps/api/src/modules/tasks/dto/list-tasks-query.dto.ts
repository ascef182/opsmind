import { IsIn, IsOptional, IsUUID } from 'class-validator';
import type { TaskStatus } from '@opsmind/database';

const TASK_STATUSES: TaskStatus[] = ['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED'];

export class ListTasksQueryDto {
  @IsOptional()
  @IsIn(TASK_STATUSES)
  status?: TaskStatus;

  @IsOptional()
  @IsUUID()
  assigneeId?: string;

  @IsOptional()
  @IsUUID()
  customerId?: string;
}
