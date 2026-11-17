import type { PrismaClient } from '@opsmind/database';
import { getEngineBudgetStatus, startOfUtcMonth } from '@opsmind/database';
import type Redis from 'ioredis';
import * as Sentry from '@sentry/node';
import { withTenantContext } from './tenant-context';

export const SPEND_ALERT_THRESHOLDS = [0.5, 0.8, 1] as const;

type BudgetKind = 'ai' | 'engine';

// Uma chave por organização/mês/teto/limiar: o alerta sai uma vez por mês e
// a chave expira sozinha depois que o mês vira.
const DEDUP_TTL_SECONDS = 40 * 86_400;

const ALERT_ROLES = ['OWNER', 'ADMIN'] as const;

export function crossedThreshold(spentUsd: number, budgetUsd: number): number | null {
  if (!(budgetUsd > 0)) return null;
  const ratio = spentUsd / budgetUsd;
  const crossed = SPEND_ALERT_THRESHOLDS.filter((threshold) => ratio >= threshold);
  return crossed.length > 0 ? crossed[crossed.length - 1]! : null;
}

/**
 * Alertas de gasto do mês para OWNER/ADMIN, a 50%, 80% e 100% de cada teto:
 * orçamento de IA (`Organization.aiMonthlyBudget`, soma de `AIRequest`) e
 * teto do Revenue Engine (razão de custos, todas as categorias). Um scan
 * periódico em vez de checar a cada gasto: cobre toda fonte de custo (API,
 * worker, chat) num lugar só, e um atraso de até uma hora é aceitável para
 * aviso (o corte de verdade continua síncrono em cada caminho que gasta).
 *
 * Avisa só o maior limiar cruzado ainda não avisado: uma organização que
 * pula de 40% para 100% recebe um alerta, não três.
 */
export async function scanSpendAlerts(prisma: PrismaClient, redis: Redis, now = new Date()): Promise<number> {
  const monthStart = startOfUtcMonth(now);
  const monthKey = monthStart.toISOString().slice(0, 7);
  const organizations = await prisma.organization.findMany({ select: { id: true, aiMonthlyBudget: true } });

  let notified = 0;
  for (const organization of organizations) {
    try {
      const engine = await getEngineBudgetStatus(prisma, organization.id, now);
      const checks: Array<{ kind: BudgetKind; spentUsd: number; budgetUsd: number }> = [
        { kind: 'engine', spentUsd: engine.spentUsd, budgetUsd: engine.budgetUsd },
      ];
      if (organization.aiMonthlyBudget !== null) {
        const ai = await prisma.aIRequest.aggregate({
          where: { organizationId: organization.id, createdAt: { gte: monthStart } },
          _sum: { estimatedCost: true },
        });
        checks.push({
          kind: 'ai',
          spentUsd: Number(ai._sum.estimatedCost ?? 0),
          budgetUsd: Number(organization.aiMonthlyBudget),
        });
      }

      for (const check of checks) {
        const threshold = crossedThreshold(check.spentUsd, check.budgetUsd);
        if (threshold === null) continue;
        const alreadySent = await claimThresholds(redis, organization.id, monthKey, check.kind, threshold);
        if (alreadySent) continue;
        notified += await notifyAdmins(prisma, organization.id, {
          budget: check.kind,
          thresholdPercent: Math.round(threshold * 100),
          spentUsd: Math.round(check.spentUsd * 100) / 100,
          budgetUsd: check.budgetUsd,
          month: monthKey,
        });
      }
    } catch (error) {
      Sentry.captureException(error, { extra: { organizationId: organization.id, phase: 'spend-alert-scan' } });
    }
  }
  return notified;
}

// Marca o limiar cruzado e os menores como avisados. Devolve true se o
// limiar cruzado já tinha sido avisado antes (nada a fazer).
async function claimThresholds(
  redis: Redis,
  organizationId: string,
  monthKey: string,
  kind: BudgetKind,
  threshold: number,
): Promise<boolean> {
  const key = (value: number) => `spend-alert:${organizationId}:${monthKey}:${kind}:${Math.round(value * 100)}`;
  const claimed = await redis.set(key(threshold), '1', 'EX', DEDUP_TTL_SECONDS, 'NX');
  if (claimed === null) return true;
  for (const lower of SPEND_ALERT_THRESHOLDS.filter((value) => value < threshold)) {
    await redis.set(key(lower), '1', 'EX', DEDUP_TTL_SECONDS, 'NX');
  }
  return false;
}

async function notifyAdmins(
  prisma: PrismaClient,
  organizationId: string,
  payload: { budget: BudgetKind; thresholdPercent: number; spentUsd: number; budgetUsd: number; month: string },
): Promise<number> {
  return withTenantContext(prisma, organizationId, async (tx) => {
    const admins = await tx.membership.findMany({
      where: { organizationId, role: { in: [...ALERT_ROLES] } },
      select: { userId: true },
    });
    if (admins.length === 0) return 0;
    await tx.notification.createMany({
      data: admins.map((admin) => ({
        organizationId,
        userId: admin.userId,
        type: 'revenue.spend_alert',
        payload,
      })),
    });
    return admins.length;
  });
}
