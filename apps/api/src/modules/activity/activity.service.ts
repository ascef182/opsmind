import { Injectable } from '@nestjs/common';
import type { ActivityLog, AuditActorType, Prisma } from '@opsmind/database';
import { PrismaService } from '../../infrastructure/database/prisma.service';

export interface LogActivityInput {
  organizationId: string;
  customerId: string;
  type: string;
  actorType: AuditActorType;
  actorId?: string;
  payload?: Prisma.InputJsonValue;
}

/**
 * Timeline do cliente (PRD §9). Reutilizado por `modules/customers` (notas
 * manuais) e `modules/tasks` (conclusão de tarefa) — um único lugar que grava
 * a atividade E mantém `Customer.lastActivityAt` em dia, na mesma transação
 * (regra de negócio central do PRD §8: "cliente inativo há mais de N dias").
 */
@Injectable()
export class ActivityService {
  constructor(private readonly prisma: PrismaService) {}

  async log(input: LogActivityInput): Promise<ActivityLog> {
    const [activity] = await this.prisma.$transaction([
      this.prisma.activityLog.create({ data: input }),
      this.prisma.customer.update({
        where: { id: input.customerId },
        data: { lastActivityAt: new Date() },
      }),
    ]);
    return activity;
  }

  listForCustomer(organizationId: string, customerId: string): Promise<ActivityLog[]> {
    return this.prisma.activityLog.findMany({
      where: { organizationId, customerId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
