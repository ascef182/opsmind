import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@opsmind/shared-types';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { ROLE_HIERARCHY } from '../constants/roles.constant';

/**
 * Roda depois do `TenantGuard` (que anexa `req.membership`) nas rotas que
 * declaram `@Roles(...)`. Hierarquia linear (Decisão #11 do blueprint):
 * papel de índice N em ROLE_HIERARCHY pode tudo que papéis de índice > N podem.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const membership = request.membership;

    if (!membership) {
      throw new ForbiddenException('Requer vínculo com a organização');
    }

    const memberLevel = ROLE_HIERARCHY.indexOf(membership.role as Role);
    const hasSufficientRole = requiredRoles.some(
      (role) => memberLevel <= ROLE_HIERARCHY.indexOf(role),
    );

    if (!hasSufficientRole) {
      throw new ForbiddenException('Papel insuficiente para esta ação');
    }

    return true;
  }
}
