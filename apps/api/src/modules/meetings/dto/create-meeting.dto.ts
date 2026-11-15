import { Type } from 'class-transformer';
import { IsDate, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreateMeetingDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(200)
  title!: string;

  @Type(() => Date)
  @IsDate()
  scheduledAt!: Date;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(480)
  durationMinutes?: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  location?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
