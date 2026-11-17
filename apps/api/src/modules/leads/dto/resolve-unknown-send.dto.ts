import { IsIn } from 'class-validator';

export class ResolveUnknownSendDto {
  @IsIn(['SENT', 'NOT_SENT'])
  outcome!: 'SENT' | 'NOT_SENT';
}
