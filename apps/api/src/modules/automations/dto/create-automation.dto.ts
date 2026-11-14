import { IsBoolean, IsIn, IsNotEmpty, IsObject, IsOptional, MaxLength } from 'class-validator';
import type { AutomationTrigger } from '@opsmind/database';
import type {
  CustomerInactiveActions,
  CustomerInactiveConditions,
  DealSilentForActions,
  DealSilentForConditions,
  DealStaleActions,
  DealStaleConditions,
} from '../automations.service';

// Triggers aceitos na API (schema.prisma, AutomationTrigger) — a lista cresce
// junto com o enum, nunca antes dele.
const AUTOMATION_TRIGGERS: AutomationTrigger[] = ['CUSTOMER_INACTIVE', 'DEAL_STAGE_STALE', 'DEAL_SILENT_FOR'];

export class CreateAutomationDto {
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsIn(AUTOMATION_TRIGGERS)
  trigger!: AutomationTrigger;

  // Forma esperada por trigger (ver automations.service.ts) validada só
  // estruturalmente (@IsObject) nesta fase — cada trigger tem poucos campos
  // opcionais, uma classe própria com @ValidateNested por trigger vale a pena
  // quando a validação de campos precisar de regras mais finas.
  @IsOptional()
  @IsObject()
  conditions?: CustomerInactiveConditions | DealStaleConditions | DealSilentForConditions;

  @IsObject()
  actions!: CustomerInactiveActions | DealStaleActions | DealSilentForActions;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
