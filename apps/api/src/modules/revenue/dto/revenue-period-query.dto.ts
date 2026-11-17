import { IsIn, IsOptional } from 'class-validator';
import type { RevenuePeriod } from '../revenue-metrics';

export class RevenuePeriodQueryDto {
  @IsOptional()
  @IsIn(['day', 'week', 'month'])
  period?: RevenuePeriod;
}
