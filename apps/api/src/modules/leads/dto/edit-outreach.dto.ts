import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

// Edita o texto de uma OutreachMessage ainda em DRAFT (Task 15) — a única
// via de ajuste de conteúdo até aqui era reject+regenerate, que rechama a
// IA. `body` obrigatório (mesmo teto de tamanho razoável pro canal que o
// resto do módulo usa); `subject` opcional, mesmo campo nullable do model.
export class EditOutreachDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  body!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  subject?: string;
}
