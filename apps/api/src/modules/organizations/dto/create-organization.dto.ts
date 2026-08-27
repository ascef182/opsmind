import { IsNotEmpty, IsOptional, Matches, MaxLength } from 'class-validator';

export class CreateOrganizationDto {
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  // Se omitido, o service gera o slug a partir do nome. Quando informado,
  // precisa já estar no formato final (minúsculas, hífens) — sem normalização
  // implícita, para o que o usuário vê no formulário ser o que é persistido.
  @IsOptional()
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message: 'slug deve conter apenas letras minúsculas, números e hífens',
  })
  slug?: string;
}
