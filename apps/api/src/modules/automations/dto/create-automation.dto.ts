import { IsBoolean, IsIn, IsNotEmpty, IsObject, IsOptional, MaxLength } from 'class-validator';
import type { AutomationTrigger } from '@opsmind/database';
import type { CustomerInactiveActions, CustomerInactiveConditions } from '../automations.service';

// Único trigger do MVP (schema.prisma, AutomationTrigger) — a lista cresce
// junto com o enum, nunca antes dele.
const AUTOMATION_TRIGGERS: AutomationTrigger[] = ['CUSTOMER_INACTIVE'];

export class CreateAutomationDto {
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsIn(AUTOMATION_TRIGGERS)
  trigger!: AutomationTrigger;

  // Forma esperada por trigger (ver automations.service.ts) validada só
  // estruturalmente (@IsObject) nesta fase — o único trigger existente tem
  // poucos campos opcionais, uma classe própria com @ValidateNested vale a
  // pena quando houver um segundo trigger com forma diferente.
  @IsOptional()
  @IsObject()
  conditions?: CustomerInactiveConditions;

  @IsObject()
  actions!: CustomerInactiveActions;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
