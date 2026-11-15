import { IsBoolean, IsObject, IsOptional, MaxLength, MinLength } from 'class-validator';

// `trigger` fica de fora deliberadamente — ver UpdateAutomationInput em
// automations.service.ts.
export class UpdateAutomationDto {
  @IsOptional()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsObject()
  conditions?: object;

  @IsOptional()
  @IsObject()
  actions?: object;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
