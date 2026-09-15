import { Type } from 'class-transformer';
import { IsDate, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

// `organizationId`/`stage`/`actorType`/`actorId` nunca vêm daqui — `stage`
// sempre nasce QUALIFICATION (default do schema); mudar de estágio passa
// exclusivamente por `POST .../deals/:dealId/move-stage`.
export class CreateDealDto {
  @IsUUID()
  customerId!: string;

  @IsNotEmpty()
  @IsString()
  title!: string;

  @IsNumber()
  @Min(0)
  value!: number;

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
