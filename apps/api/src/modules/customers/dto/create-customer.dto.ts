import { IsArray, IsEmail, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import type { CustomerStatus } from '@opsmind/database';

const CUSTOMER_STATUSES: CustomerStatus[] = ['LEAD', 'ACTIVE', 'INACTIVE'];

export class CreateCustomerDto {
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  company?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsIn(CUSTOMER_STATUSES)
  status?: CustomerStatus;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}
