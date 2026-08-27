import { SetMetadata } from '@nestjs/common';
import type { Role } from '@opsmind/shared-types';

export const ROLES_KEY = 'roles';

/**
 * Declara quais papéis (no mínimo) uma rota exige. Consumido pelo
 * `RolesGuard` (Passo 8), que compara contra `ROLE_HIERARCHY`.
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
