import { Type } from 'class-transformer';
import { IsDate, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

// Exclui `stage` deliberadamente — mesma lógica de `UpdateLeadDto` rejeitando
// `CONVERTED`: mudança de estágio só passa pelo endpoint dedicado
// (`POST .../deals/:dealId/move-stage`), nunca por este PATCH genérico.
export class UpdateDealDto {
  @IsOptional()
  @IsNotEmpty()
  @IsString()
  title?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  value?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  expectedCloseDate?: Date;

  @IsOptional()
  @IsUUID()
  ownerUserId?: string;
}
