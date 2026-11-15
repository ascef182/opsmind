'use client';

import { useParams } from 'next/navigation';
import { useCurrentMembership } from '@/lib/memberships/use-memberships';
import { AiUsagePanel } from '@/components/ai/ai-usage-panel';

const BUDGET_MANAGER_ROLES = ['OWNER', 'ADMIN'];

export default function AiUsagePage() {
  const { organizationId } = useParams<{ organizationId: string }>();
  const { membership, isLoading } = useCurrentMembership(organizationId);

  if (isLoading) {
    return <p className="text-muted-foreground">Carregando…</p>;
  }

  const canManageBudget = membership ? BUDGET_MANAGER_ROLES.includes(membership.role) : false;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-foreground">Uso de IA</h1>
      <AiUsagePanel organizationId={organizationId} canManageBudget={canManageBudget} />
    </div>
  );
}
