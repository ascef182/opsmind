import type { Role } from '@opsmind/shared-types';
import { ROLE_HIERARCHY } from '../constants/roles.constant';

/**
 * Regra de segurança da Fase 1 (checklist — sprint-1-2-plan.md §4): quem age
 * (convida, muda papel, remove) nunca pode fazê-lo sobre um papel igual ou
 * mais privilegiado que o seu próprio — evita, por exemplo, um Manager
 * convidando/promovendo alguém a Owner. Usada em invite, updateRole e remove.
 */
export function canAssignRole(actingRole: Role, otherRole: Role): boolean {
  return ROLE_HIERARCHY.indexOf(otherRole) > ROLE_HIERARCHY.indexOf(actingRole);
}
