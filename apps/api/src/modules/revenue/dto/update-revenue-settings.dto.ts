import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

// Campo omitido = não mexe. Tetos altos o bastante para não travar uso real,
// baixos o bastante para um erro de digitação não virar milhares de envios.
export class UpdateRevenueSettingsDto {
  @IsOptional()
  @IsBoolean()
  outreachPaused?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  outreachPausedReason?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(500)
  dailySendLimit?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2000)
  dailyResearchLimit?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100000)
  engineMonthlyBudgetUsd?: number;

  @IsOptional()
  @IsIn(['US', 'BR'])
  defaultOutreachCountry?: string;
}
