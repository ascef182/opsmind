import { Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import type { Notification } from '@opsmind/database';
import { NotificationsService } from './notifications.service';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';

// Sem RolesGuard: notificações são sempre "as minhas" — o escopo por dono já
// é a proteção (nunca lista/marca a notificação de outro membro).
@UseGuards(TenantGuard)
@Controller('organizations/:organizationId/notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  list(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { id: string },
  ): Promise<Notification[]> {
    return this.notificationsService.listForUser(organizationId, user.id);
  }

  @Patch(':notificationId/read')
  markRead(
    @Param('organizationId') organizationId: string,
    @Param('notificationId') notificationId: string,
    @CurrentUser() user: { id: string },
  ): Promise<Notification> {
    return this.notificationsService.markRead(organizationId, user.id, notificationId);
  }
}
