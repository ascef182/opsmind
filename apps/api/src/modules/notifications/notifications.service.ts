import { Injectable, NotFoundException } from '@nestjs/common';
import type { Notification, Prisma } from '@opsmind/database';
import { PrismaService } from '../../infrastructure/database/prisma.service';

export interface CreateNotificationInput {
  organizationId: string;
  userId: string;
  type: string;
  payload?: Prisma.InputJsonValue;
}

/** Notificações in-app (PRD §6). Sem envio por email nesta fase. */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  create(input: CreateNotificationInput): Promise<Notification> {
    return this.prisma.notification.create({ data: input });
  }

  listForUser(organizationId: string, userId: string): Promise<Notification[]> {
    return this.prisma.notification.findMany({
      where: { organizationId, userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async markRead(
    organizationId: string,
    userId: string,
    notificationId: string,
  ): Promise<Notification> {
    // Escopado por userId na própria query: uma notificação só pode ser
    // marcada como lida por quem é dona dela, nunca por outro membro da org.
    const notification = await this.prisma.notification.findFirst({
      where: { id: notificationId, organizationId, userId },
    });
    if (!notification) {
      throw new NotFoundException('Notificação não encontrada');
    }
    if (notification.readAt) {
      return notification;
    }
    return this.prisma.notification.update({
      where: { id: notificationId },
      data: { readAt: new Date() },
    });
  }
}
