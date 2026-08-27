import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { from, Observable } from 'rxjs';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { tenantContextStorage } from '../context/tenant-context.storage';

interface RequestWithTenantContext {
  user?: { id: string };
  membership?: { organizationId: string };
}

/**
 * Global (registrado via APP_INTERCEPTOR): abre UMA transação Prisma por
 * request autenticada, seta as variáveis de sessão do Postgres que as
 * policies de RLS usam, e disponibiliza essa transação via AsyncLocalStorage
 * para todo o resto do pipeline (services chamados pelo controller) — sem
 * que nenhum service precise saber disso (ver PrismaService/
 * createTenantAwareProxy).
 *
 * Duas variáveis, não uma, e por um motivo não-circular:
 *   - `app.current_user_id`: sempre que a rota está autenticada (req.user
 *     existe). Usada pelas policies de `memberships`/`organizations`, que
 *     precisam funcionar mesmo ANTES de o TenantGuard validar um org_id —
 *     é a própria query de Membership que faz essa validação.
 *   - `app.current_org_id`: só quando a rota passou pelo TenantGuard
 *     (req.membership existe). Usada pelas policies de
 *     `customers`/`tasks`/`activity_logs`/`notifications`/`audit_logs`.
 *
 * Rotas públicas (sem req.user — register/login/refresh/logout/health) não
 * abrem transação nenhuma: não têm dado de tenant para proteger.
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<RequestWithTenantContext>();
    if (!request.user) {
      return next.handle();
    }

    const { user, membership } = request;

    return from(
      this.prisma.runInTransaction(async (tx) => {
        return tenantContextStorage.run(tx, async () => {
          await tx.$executeRaw`SELECT set_config('app.current_user_id', ${user.id}, true)`;
          if (membership) {
            await tx.$executeRaw`SELECT set_config('app.current_org_id', ${membership.organizationId}, true)`;
          }
          return firstValueFrom(next.handle());
        });
      }),
    );
  }
}
