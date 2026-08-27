import { IsIn, IsOptional, IsString } from 'class-validator';
import type { CustomerStatus } from '@opsmind/database';

const CUSTOMER_STATUSES: CustomerStatus[] = ['LEAD', 'ACTIVE', 'INACTIVE'];

export class ListCustomersQueryDto {
  @IsOptional()
  @IsIn(CUSTOMER_STATUSES)
  status?: CustomerStatus;

  @IsOptional()
  @IsString()
  tag?: string;

  @IsOptional()
  @IsString()
  search?: string;
}
