import { IsIn, IsOptional, IsString } from 'class-validator';
import type { OutreachChannel } from '@opsmind/database';

const OUTREACH_CHANNELS: OutreachChannel[] = [
  'EMAIL',
  'PHONE',
  'WHATSAPP',
  'LINKEDIN_DM',
  'REDDIT_DM',
  'INSTAGRAM_DM',
  'OTHER',
];

// `serviceOfferingId` é opcional: se ausente, `OutreachService.generateDraft`
// cai para `lead.suggestedOfferingId` (populado por `POST .../score`). Se
// nenhum dos dois existir, o service lança BadRequestException.
export class GenerateOutreachDto {
  @IsIn(OUTREACH_CHANNELS)
  channel!: OutreachChannel;

  @IsOptional()
  @IsString()
  serviceOfferingId?: string;
}
