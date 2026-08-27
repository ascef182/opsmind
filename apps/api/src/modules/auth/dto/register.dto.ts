import { IsEmail, IsNotEmpty, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email!: string;

  // 8 caracteres é o piso mínimo razoável para senha (não há política mais
  // específica no PRD); Argon2id absorve o resto do trabalho de robustez.
  @MinLength(8)
  password!: string;

  @IsNotEmpty()
  name!: string;
}
