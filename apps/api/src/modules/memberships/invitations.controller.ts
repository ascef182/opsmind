import { Controller, Param, Post } from '@nestjs/common';
import type { Membership } from '@opsmind/database';
import { InvitationsService } from './invitations.service';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';

// Fora do padrão `/organizations/:organizationId/...` de propósito: aceitar
// um convite acontece antes de o usuário ter qualquer vínculo — é o próprio
// token que carrega a organização, então não há :organizationId na rota
// para o TenantGuard checar. Só exige estar autenticado (JwtAuthGuard global).
@Controller('invitations')
export class InvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  @Post(':token/accept')
  accept(
    @Param('token') token: string,
    @CurrentUser() user: { id: string; email: string },
  ): Promise<Membership> {
    return this.invitationsService.accept(user.id, user.email, token);
  }
}
