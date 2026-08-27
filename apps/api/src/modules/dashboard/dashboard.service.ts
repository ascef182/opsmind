import { Injectable } from '@nestjs/common';
import type { ActivityLog, CustomerStatus, TaskStatus } from '@opsmind/database';
import { PrismaService } from '../../infrastructure/database/prisma.service';

const CUSTOMER_STATUSES: CustomerStatus[] = ['LEAD', 'ACTIVE', 'INACTIVE'];
const TASK_STATUSES: TaskStatus[] = ['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED'];
const RECENT_ACTIVITY_LIMIT = 10;

export interface DashboardOverview {
  customers: {
    total: number;
    byStatus: Record<CustomerStatus, number>;
    // Regra de negócio do PRD §8 — distinta do campo `status` (que é
    // manual/definido por automação): conta quem não tem NENHUMA atividade
    // há mais de `organization.inactiveAfterDays` dias. Um cliente sem
    // nenhuma atividade ainda (lastActivityAt null) não entra aqui — é um
    // LEAD que ainda não começou, não alguém que "parou de responder".
    inactiveByRule: number;
  };
  tasks: {
    total: number;
    byStatus: Record<TaskStatus, number>;
  };
  recentActivity: ActivityLog[];
}

function toCountMap<T extends string>(
  groups: Array<{ status: T; _count: { _all: number } }>,
  statuses: T[],
): Record<T, number> {
  const map = Object.fromEntries(statuses.map((status) => [status, 0])) as Record<T, number>;
  for (const group of groups) {
    map[group.status] = group._count._all;
  }
  return map;
}

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(organizationId: string): Promise<DashboardOverview> {
    const [customersByStatus, tasksByStatus, organization, recentActivity] = await Promise.all([
      this.prisma.customer.groupBy({
        by: ['status'],
        where: { organizationId, deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.task.groupBy({
        by: ['status'],
        where: { organizationId },
        _count: { _all: true },
      }),
      this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId } }),
      this.prisma.activityLog.findMany({
        where: { organizationId },
        orderBy: { createdAt: 'desc' },
        take: RECENT_ACTIVITY_LIMIT,
      }),
    ]);

    const inactiveCutoff = new Date();
    inactiveCutoff.setDate(inactiveCutoff.getDate() - organization.inactiveAfterDays);

    const inactiveByRule = await this.prisma.customer.count({
      where: { organizationId, deletedAt: null, lastActivityAt: { lt: inactiveCutoff } },
    });

    const customersMap = toCountMap(customersByStatus, CUSTOMER_STATUSES);
    const tasksMap = toCountMap(tasksByStatus, TASK_STATUSES);

    return {
      customers: {
        total: Object.values(customersMap).reduce((sum, n) => sum + n, 0),
        byStatus: customersMap,
        inactiveByRule,
      },
      tasks: {
        total: Object.values(tasksMap).reduce((sum, n) => sum + n, 0),
        byStatus: tasksMap,
      },
      recentActivity,
    };
  }
}
