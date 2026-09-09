import { IsIn, IsUrl, MaxLength } from 'class-validator';
import { SOCIAL_PLATFORMS, type SocialPlatform } from '@opsmind/shared-types';

// Um item de `Lead.socialLinks` (coluna JSON livre — ver comentário em
// packages/database/prisma/schema.prisma sobre por que continua JSON em vez
// de colunas próprias) validado individualmente na borda da API antes de
// virar JSON. Classe própria (não inline) porque é reaproveitada por
// `CreateLeadDto` e `UpdateLeadDto` (Task 4) — sem precedente de array de
// objeto aninhado neste repo, então segue a sintaxe padrão
// `class-validator`/`class-transformer` sem inventar nada além disso.
export class SocialLinkDto {
  @IsIn(SOCIAL_PLATFORMS)
  platform!: SocialPlatform;

  @IsUrl()
  @MaxLength(500)
  url!: string;
}
