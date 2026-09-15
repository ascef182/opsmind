import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import type { DealStage } from '@opsmind/database';

const DEAL_STAGES: DealStage[] = [
  'QUALIFICATION',
  'PROPOSAL',
  'NEGOTIATION',
  'CONTRACT_SENT',
  'WON',
  'LOST',
];

export class ListDealsQueryDto {
  @IsOptional()
  @IsIn(DEAL_STAGES)
  stage?: DealStage;

  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsUUID()
  ownerUserId?: string;

  @IsOptional()
  @IsString()
  search?: string;
}
