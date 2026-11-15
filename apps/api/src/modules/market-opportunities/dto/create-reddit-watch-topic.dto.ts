import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

// Espelha `CreateServiceOfferingDto` — `query` é obrigatório (o termo de
// busca em si), `subreddit` opcional (restringe a busca a uma comunidade
// específica; ausente = busca ampla), `isActive` aceito na criação (mesmo
// padrão de `ProspectingTarget`, que também tira o campo do "ligado por
// padrão, desligado manualmente depois").
export class CreateRedditWatchTopicDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  query!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  subreddit?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
