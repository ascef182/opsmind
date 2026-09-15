import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import type { DealStage } from '@opsmind/database';

const DEAL_STAGES: DealStage[] = [
  'QUALIFICATION',
  'PROPOSAL',
  'NEGOTIATION',
  'CONTRACT_SENT',
  'WON',
  'LOST',
];

export class MoveDealStageDto {
  @IsIn(DEAL_STAGES)
  stage!: DealStage;

  // Obrigatório quando `stage === 'LOST'` — validado em
  // `DealsService.moveStage`, não aqui (a obrigatoriedade depende do valor de
  // outro campo do mesmo DTO).
  @IsOptional()
  @IsString()
  @MaxLength(500)
  lostReason?: string;
}
