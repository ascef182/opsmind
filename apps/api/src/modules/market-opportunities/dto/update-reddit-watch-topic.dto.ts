import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateRedditWatchTopicDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  query?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  subreddit?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
