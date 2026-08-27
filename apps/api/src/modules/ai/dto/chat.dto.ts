import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ChatDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(4000)
  message!: string;
}
