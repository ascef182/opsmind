import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';

/**
 * Para rotas no padrão `/organizations/:organizationId/...` (recursos
 * aninhados sob uma organização — memberships, audit-logs, etc., a partir do
 * Passo 9). Resolve o vínculo do usuário autenticado com essa organização a
 * cada request (nunca a partir do JWT — Decisão #4) e anexa `req.membership`
 * para `RolesGuard`/`@CurrentMembership()` consumirem. 403 sem vínculo.
 *
 * Não se aplica a `GET /organizations/:id` (Passo 7): ali não há organização
 * "pai" para checar contra — o próprio recurso é a organização, por isso o
 * escopo é feito na query do service (`findByIdForUser`), não por este guard.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const organizationId = request.params?.organizationId;

    if (!organizationId) {
      throw new Error(
        'TenantGuard aplicado a uma rota sem :organizationId — erro de configuração da rota',
      );
    }

    const membership = await this.prisma.membership.findUnique({
      where: { userId_organizationId: { userId: request.user.id, organizationId } },
    });

    if (!membership) {
      throw new ForbiddenException('Você não tem acesso a esta organização');
    }

    request.membership = membership;
    return true;
  }
}
