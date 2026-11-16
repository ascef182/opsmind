import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateRedditWatchTopicDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  query?: string;

  // `string | null` (não só `string | undefined`): o form de edição manda
  // `null` explícito pra limpar o campo — `@IsOptional()` já trata `null`
  // como ausente de validação (pula `@IsString()`/`@MaxLength`), então só o
  // tipo TS precisava acompanhar o schema Prisma (`subreddit String?`).
  @IsOptional()
  @IsString()
  @MaxLength(100)
  subreddit?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
