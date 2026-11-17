import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import type { HarveyCommand } from '@opsmind/shared-types';

export class HarveyCommandDto {
  @IsIn(['START', 'PAUSE', 'RESUME', 'STOP'])
  command!: HarveyCommand;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  reason?: string;
}

export class ListHarveyActivitiesQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  cursor?: string;

  // ISO-8601: só atividades iniciadas/alteradas depois deste instante (reconexão do stream).
  @IsOptional()
  @IsString()
  @MaxLength(40)
  after?: string;

  @IsOptional()
  @IsIn(['RESEARCHING', 'QUALIFYING', 'PREPARING_OUTREACH', 'SENDING', 'RESPONDING', 'CONTROL'])
  phase?: string;

  @IsOptional()
  @IsIn(['STARTED', 'SUCCEEDED', 'FAILED', 'SKIPPED', 'CANCELLED'])
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  leadId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  campaignId?: string;
}
