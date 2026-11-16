import { IsNotEmpty, MaxLength } from 'class-validator';

export class CreateSignalCodeDto {
  @IsNotEmpty() @MaxLength(60) code!: string;
  @IsNotEmpty() @MaxLength(120) label!: string;
  @IsNotEmpty() @MaxLength(60) category!: string;
}
