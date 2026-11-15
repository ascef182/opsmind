import { IsOptional, IsString, MaxLength } from 'class-validator';

// Ambos os campos são opcionais: sem override, `LeadsService.convertToCustomer`
// usa `lead.name` para os dois (nome do negócio como `Customer.name` E
// `Customer.company` — este Lead não distingue "nome do contato" de "nome
// do negócio", diferente de um CRM B2C).
export class ConvertLeadDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  company?: string;
}
