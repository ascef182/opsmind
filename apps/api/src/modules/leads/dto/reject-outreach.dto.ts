import { IsOptional, IsString } from 'class-validator';

export class RejectOutreachDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
